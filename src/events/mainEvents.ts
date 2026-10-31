// @ts-nocheck
import { respondToAmendment } from '../actions/amendmentActions';
import { cancelProposalMeeting } from '../actions/biddingActions';
import { DEFAULT_MEETING_DURATION_MINUTES, escapeMeetingText, findMeetingConflicts, meetingDuration } from '../domain/meetingSchedule';
import { closeModal } from '../actions/modalActions';
import { renderApp } from '../core/renderBridge';
import { financeAPI } from '../services/finance';
import { canManageBidding, canManageDeliveryIssues, getAgreementFinalizationError, hasPermission } from '../domain/permissions';
import { getAvailableRequisitions, getRemainingOrderQuantity, isOrderFullyVerified } from '../domain/procurement';
import { logAudit } from '../services/audit';
import { CLOUD_API_BASE, CLOUD_TOKEN_KEY, CLOUD_USERNAME_KEY, cloudRequest } from '../services/cloud';
import { validateSupplierQuotationTerms, type SupplierQuotationTerms } from '../domain/bidTerms';
import { Storage } from '../services/storage';
import { showToast } from '../services/toast';
import { DB, ui } from '../store/state';
import { financeAPI } from '../services/finance';
import { navigateTo } from '../core/renderBridge';

// Migrated from enterprise.html. Business rules / markup preserved.
export function attachMainEvents() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const token = localStorage.getItem(CLOUD_TOKEN_KEY);
            logAudit('User Logout', `User ${DB.currentUser.name} logged out.`);
            try {
                await Storage.flush();
            } catch {
                // The save failure is reported by Storage.save; continue signing out.
            }
            if (CLOUD_API_BASE && token) {
                try {
                    await cloudRequest('/auth/logout', { method: 'POST' }, token);
                } catch (error) {
                    console.error('Cloud sign-out could not invalidate the session.', error);
                    showToast('Could not invalidate the cloud session; it will expire automatically.', 'warning');
                }
                localStorage.removeItem(CLOUD_TOKEN_KEY);
                localStorage.removeItem(CLOUD_USERNAME_KEY);
            }
            DB.currentUser = null;
            Storage.save(DB);
            renderApp();
        });
    }

    const resetBtn = document.getElementById('reset-db-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            if (DB.currentUser?.role !== 'Admin') {
                showToast('Only the Administrator can reset procurement records.', 'error');
                return;
            }
            const confirmation = window.prompt(
                'ADMIN ONLY: Clear requisitions, orders, approvals, supplier invoices, activity history, and old notification read receipts? User accounts, uploaded documents and Finance settings remain. This cannot be undone without a backup. Type RESET to confirm.'
            );
            if (confirmation === null) return;
            if (confirmation !== 'RESET') {
                showToast('Reset cancelled: enter RESET exactly to confirm.', 'warning');
                return;
            }
            try {
                await Storage.reset();
            } catch (error) {
                showToast(error instanceof Error ? error.message : 'Cloud reset failed. No records were cleared locally.', 'error');
            }
        });
    }

    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const tab = e.currentTarget.getAttribute('data-tab');
            ui.currentTab = tab;
            renderApp();
        });
    });

    const quickCreatePr = document.getElementById('quick-create-pr-btn');
    if (quickCreatePr) {
        quickCreatePr.addEventListener('click', () => {
            ui.currentModal = 'create_pr';
            renderApp();
        });
    }

    const openPrModalBtn = document.getElementById('open-create-pr-modal');
    if (openPrModalBtn) {
        openPrModalBtn.addEventListener('click', () => {
            ui.currentModal = 'create_pr';
            renderApp();
        });
    }

    const needRequestSelect = document.getElementById('sn-pr-id');
    if (needRequestSelect) {
        needRequestSelect.addEventListener('change', () => {
            const pr = getAvailableRequisitions().find(item => item.id === needRequestSelect.value);
            document.getElementById('sn-title').value = pr?.itemTitle || '';
            document.getElementById('sn-qty').value = pr?.quantity || '';
            document.getElementById('sn-budget').value = pr?.totalCost || '';
            document.getElementById('sn-specs').value = pr?.specs || '';
        });
    }

    // Star Rating Picker
    const starPicker = document.getElementById('star-picker');
    if (starPicker) {
        const stars = starPicker.querySelectorAll('i');
        const ratingInput = document.getElementById('rating-value');
        stars.forEach((star, idx) => {
            star.addEventListener('click', () => {
                const score = idx + 1;
                ratingInput.value = score;
                stars.forEach((s, i) => {
                    if (i < score) {
                        s.className = 'fa-solid fa-star text-amber-400';
                    } else {
                        s.className = 'fa-regular fa-star text-slate-300';
                    }
                });
            });
        });
    }

    document.querySelectorAll('form[data-amendment-response-form]').forEach(form => {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const amendmentId = form.getAttribute('data-amendment-response-form');
            const response = form.querySelector('[data-amendment-response]').value;
            respondToAmendment(amendmentId, response);
        });
    });

    // Forms Submit Events
    const createPrForm = document.getElementById('create-pr-form');
    if (createPrForm) {
        createPrForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('pr-title').value.trim();
            const specs = document.getElementById('pr-specs').value.trim();
            const qty = parseInt(document.getElementById('pr-qty').value);
            const price = parseFloat(document.getElementById('pr-price').value);
            const targetDate = document.getElementById('pr-date').value;
            const remarks = document.getElementById('pr-remarks').value.trim();

            const newPR = {
                id: 'PR-' + (1000 + DB.requisitions.length + 1),
                department: DB.currentUser.department,
                itemTitle: title,
                specs: specs,
                targetDate: targetDate,
                unitPrice: price,
                quantity: qty,
                totalCost: qty * price,
                status: 'Pending',
                requestedBy: DB.currentUser.name,
                requestedByUsername: DB.currentUser.username,
                createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
                remarks: remarks
            };

            DB.requisitions.unshift(newPR);
            logAudit('PR Created', `Requisition ${newPR.id} created for ${title}.`);
            Storage.save(DB);
            closeModal();
            if (CLOUD_API_BASE) {
                // Save the PR to the shared snapshot before initiating its D1 approval workflow.
                // Only the assigned Department Head (or Admin) is permitted to submit it.
                try {
                    await Storage.flush();
                    await financeAPI.start(newPR.id);
                    showToast(`${newPR.id} submitted to Procurement Head for review.`, 'success');
                } catch (error) {
                    showToast(`PR ${newPR.id} saved, but workflow not started: ${error instanceof Error ? error.message : String(error)}. An assigned Department Head may submit it from Approvals.`, 'warning');
                }
                navigateTo('approvals');
            } else {
                showToast(`Requisition ${newPR.id} created successfully!`, 'success');
            }
        });
    }

    const recordDeliveryForm = document.getElementById('record-delivery-form');
    if (recordDeliveryForm) {
        recordDeliveryForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const order = DB.orders.find(o => o.id === ui.selectedRecord);
            const qtyDelivered = parseInt(document.getElementById('del-qty').value);
            const delDate = document.getElementById('del-date').value;
            const notes = document.getElementById('del-notes').value.trim();
            const remainingQty = getRemainingOrderQuantity(order?.id);

            if (hasPermission('record_delivery') && order &&
                ['Approved & Signed', 'Issued'].includes(order.status) &&
                Number.isInteger(qtyDelivered) && qtyDelivered > 0 && qtyDelivered <= remainingQty && delDate) {
                const newDel = {
                    id: 'DEL-' + (8000 + DB.deliveries.length + 1),
                    poId: order.id,
                    prId: order.prId,
                    supplierName: order.supplierName,
                    department: order.department,
                    itemTitle: order.itemTitle,
                    specs: order.specs,
                    orderedQty: order.quantity,
                    deliveredQty: qtyDelivered,
                    expectedDate: delDate,
                    actualDate: delDate,
                    deliveryStatus: qtyDelivered === remainingQty ? 'Delivered' : 'Partial',
                    complianceStatus: 'Pending Inspection',
                    remarks: notes,
                    recordedBy: DB.currentUser.name,
                    updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
                };

                DB.deliveries.unshift(newDel);
                const payment = DB.payments.find(item => item.poId === order.id);
                if (payment) payment.deliveryVerified = false;
                logAudit('Delivery Recorded', `Shipment recorded for PO ${order.id}. Qty: ${qtyDelivered}`);
                Storage.save(DB);
                showToast(`Delivery logged for ${order.id}.`, 'success');
                closeModal();
            } else {
                showToast('Delivery could not be recorded. Verify PO acceptance and remaining ordered quantity.', 'error');
            }
        });
    }

    const inspectDeliveryForm = document.getElementById('inspect-delivery-form');
    if (inspectDeliveryForm) {
        inspectDeliveryForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const delivery = DB.deliveries.find(d => d.id === ui.selectedRecord);
            const inspectStatus = document.getElementById('inspect-status').value;
            const remarks = document.getElementById('inspect-remarks').value.trim();

            if (delivery) {
                delivery.complianceStatus = inspectStatus;
                delivery.remarks += ` | Inspection: ${remarks}`;

                const payment = DB.payments.find(p => p.poId === delivery.poId);
                if (payment) payment.deliveryVerified = isOrderFullyVerified(delivery.poId);

                logAudit('Delivery Inspected', `Delivery ${delivery.id} marked as ${inspectStatus}`);
                Storage.save(DB);
                showToast(`Inspection outcome logged successfully!`, 'success');
                closeModal();
            } else {
                showToast('The delivery record could not be found.', 'error');
            }
        });
    }

    const rateSupplierForm = document.getElementById('rate-supplier-form');
    if (rateSupplierForm) {
        rateSupplierForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const ratingVal = parseInt(document.getElementById('rating-value').value);
            const qScore = parseInt(document.getElementById('score-quality').value);
            const dScore = parseInt(document.getElementById('score-delivery').value);
            const pScore = parseInt(document.getElementById('score-pricing').value);
            const feedback = document.getElementById('rating-feedback').value.trim();
            const supplierId = typeof ui.selectedRecord === 'object' ? ui.selectedRecord.supplierId : null;
            const poId = typeof ui.selectedRecord === 'object' ? ui.selectedRecord.poId : null;
            const payment = DB.payments.find(item => item.poId === poId);
            const order = DB.orders.find(item => item.id === poId && item.supplierId === supplierId);

            if (!hasPermission('rate_supplier') || !payment || payment.status !== 'Paid' || !order ||
                !isOrderFullyVerified(poId) || DB.ratings.some(item => item.poId === poId) ||
                !Number.isInteger(ratingVal) || ratingVal < 1 || ratingVal > 5 ||
                !Number.isInteger(qScore) || qScore < 1 || qScore > 5 ||
                !Number.isInteger(dScore) || dScore < 1 || dScore > 5 ||
                !Number.isInteger(pScore) || pScore < 1 || pScore > 5 || !feedback) {
                showToast('A valid evaluation can be submitted only for a completed and paid transaction.', 'error');
                return;
            }
            const newRating = {
                id: 'rat-' + Date.now(),
                supplierId,
                poId,
                evaluatorName: DB.currentUser.name,
                evaluatorRole: DB.currentUser.role,
                rating: ratingVal,
                qualityScore: qScore,
                deliveryScore: dScore,
                pricingScore: pScore,
                feedback: feedback,
                createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
            };

            DB.ratings.unshift(newRating);
            logAudit('Supplier Evaluated', `Rating submitted for supplier ${supplierId} after transaction ${poId}.`);
            Storage.save(DB);
            showToast('Supplier evaluation recorded.', 'success');
            closeModal();
        });
    }

    const addSupplierForm = document.getElementById('add-supplier-form');
    if (addSupplierForm) {
        addSupplierForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('sup-name').value.trim();
            const contact = document.getElementById('sup-contact').value.trim();
            const email = document.getElementById('sup-email').value.trim();
            const phone = document.getElementById('sup-phone').value.trim();
            const category = document.getElementById('sup-category').value.trim();

            const newSup = {
                id: 'sup-' + Date.now(),
                name,
                contact,
                email,
                phone,
                category
            };

            DB.suppliers.push(newSup);
            logAudit('Supplier Added', `Vendor ${name} registered into vendor system.`);
            Storage.save(DB);
            showToast(`Supplier ${name} added successfully!`, 'success');
            closeModal();
        });
    }

    const processPaymentForm = document.getElementById('process-payment-form');
    if (processPaymentForm) {
        processPaymentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payment = DB.payments.find(p => p.id === ui.selectedRecord);
            const method = document.getElementById('pay-method').value;
            const ref = document.getElementById('pay-ref').value.trim();

            if (hasPermission('process_payment') && payment && payment.status === 'Pending' &&
                isOrderFullyVerified(payment.poId) && method && ref) {
                // Verify against the server immediately before changing any payment record.
                if (CLOUD_API_BASE) {
                    try {
                        await Storage.flush();
                        const matching = await financeAPI.matchStatus(payment.poId);
                        if (!matching.matched) {
                            showToast('Cannot disburse: ' + matching.reasons.join(' '), 'error');
                            return;
                        }
                    } catch (error) {
                        showToast(error instanceof Error ? error.message : 'Invoice match verification failed.', 'error');
                        return;
                    }
                }
                payment.paymentMethod = method;
                payment.refNumber = ref;
                payment.status = 'Paid';
                payment.paymentDate = new Date().toISOString().substring(0, 10);
                payment.processedBy = DB.currentUser.name;

                logAudit('Disbursement Completed', `Payment ${payment.id} processed via ${method}. Ref: ${ref}`);
                Storage.save(DB);
                showToast(`Disbursement of ₱${payment.paymentAmount.toLocaleString()} confirmed!`, 'success');
                closeModal();
            } else {
                showToast('Payment is blocked until every item is received and verified.', 'error');
            }
        });
    }

    const initiateAmendmentForm = document.getElementById('initiate-amendment-form');
    if (initiateAmendmentForm) {
        initiateAmendmentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const reason = document.getElementById('amend-reason').value.trim();
            const qty = parseInt(document.getElementById('amend-qty').value);
            const specs = document.getElementById('amend-specs').value.trim();
            const order = DB.orders.find(item => item.id === ui.selectedRecord.poId);
            const delivery = DB.deliveries.find(item => item.id === ui.selectedRecord.delId && item.poId === ui.selectedRecord.poId);

            if (!canManageDeliveryIssues() || !order || !delivery ||
                !Number.isInteger(qty) || qty < 1 || !reason || !specs) {
                showToast('Amendment details are invalid or the delivery issue is no longer actionable.', 'error');
                return;
            }
            const newAmd = {
                id: 'AMD-' + (3000 + DB.amendments.length + 1),
                poId: ui.selectedRecord.poId,
                delId: ui.selectedRecord.delId,
                supplierId: order.supplierId,
                supplierName: order.supplierName,
                reason: reason,
                revisedQty: qty,
                revisedSpecs: specs,
                approvalStatus: 'Pending Supplier Response',
                requestedBy: DB.currentUser.name
            };

            DB.amendments.unshift(newAmd);
            logAudit('Amendment Issued', `Amendment ${newAmd.id} issued to ${order.supplierName} for PO ${ui.selectedRecord.poId}.`);
            Storage.save(DB);
            showToast('Order amendment issued; awaiting the supplier explanation.', 'success');
            closeModal();
        });
    }

    const createStockNeedForm = document.getElementById('create-stock-need-form');
    if (createStockNeedForm) {
        createStockNeedForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const prId = document.getElementById('sn-pr-id').value;
            const pr = getAvailableRequisitions().find(item => item.id === prId);
            const title = document.getElementById('sn-title').value.trim();
            const targetQty = parseInt(document.getElementById('sn-qty').value);
            const budgetCap = parseFloat(document.getElementById('sn-budget').value);
            const techSpecs = document.getElementById('sn-specs').value.trim();

            if (!canManageBidding() || !pr || !title || !techSpecs ||
                !Number.isInteger(targetQty) || targetQty < 1 ||
                !Number.isFinite(budgetCap) || budgetCap < 0) {
                showToast('A published need must be based on an approved request with valid details.', 'error');
                return;
            }

            const newNeed = {
                id: 'SN-' + (2000 + DB.stockNeeds.length + 1),
                prId: pr.id,
                title,
                targetQty,
                budgetCap,
                techSpecs,
                status: 'Published',
                createdBy: DB.currentUser.name,
                createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
            };

            DB.stockNeeds.unshift(newNeed);
            logAudit('Stock Need Published', `Stock Need ${newNeed.id} published by ${DB.currentUser.name}`);
            Storage.save(DB);
            showToast(`Stock Need ${newNeed.id} published for bidding!`, 'success');
            closeModal();
        });
    }

    const submitBidForm = document.getElementById('submit-bid-form');
    if (submitBidForm) {
        const unitPriceInput = document.getElementById('bid-unit-price');
        const totalPreview = document.getElementById('bid-total-preview');
        const need = DB.stockNeeds.find(s => s.id === ui.selectedRecord);
        unitPriceInput.addEventListener('input', () => {
            const unitPrice = Number(unitPriceInput.value);
            totalPreview.textContent = Number.isFinite(unitPrice) && unitPrice >= 0
                ? `₱${(unitPrice * (need?.targetQty || 0)).toLocaleString()}`
                : 'Enter a valid unit price';
        });
        submitBidForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const supplier = DB.suppliers.find(s => s.id === DB.currentUser.supplierId);
            const unitPrice = Number(document.getElementById('bid-unit-price').value);
            const leadTimeDays = Number(document.getElementById('bid-lead-time').value);
            const notes = document.getElementById('bid-notes').value.trim();
            const field = id => document.getElementById(id).value.trim();
            const numberField = id => field(id) === '' ? NaN : Number(field(id));
            const quotationTerms: SupplierQuotationTerms = {
                version: 1,
                offeredModel: field('bid-offered-model'),
                specificationClaim: field('bid-specification-claim'),
                specificationExceptions: field('bid-specification-exceptions'),
                deliveryCommitment: field('bid-delivery-commitment'),
                warrantyMonths: numberField('bid-warranty-months'),
                warrantyCoverage: field('bid-warranty-coverage'),
                warrantyService: field('bid-warranty-service'),
                replacementDays: numberField('bid-replacement-days'),
                paymentCondition: field('bid-payment-condition'),
                validityDays: numberField('bid-validity-days'),
                afterSalesSupport: field('bid-after-sales-support'),
                supportingReference: field('bid-supporting-reference'),
                additionalClauses: field('bid-additional-clauses'),
                supplierDeclaration: document.getElementById('bid-terms-confirm').checked
            };

            if (DB.currentUser.role !== 'Supplier') {
                showToast('Only supplier accounts can submit bids.', 'error');
                return;
            }
            if (!need || need.status !== 'Published') {
                showToast('This procurement need is no longer open for bidding.', 'error');
                return;
            }
            if (!supplier) {
                showToast('Your account is missing its supplier profile. Contact the administrator to link your company profile.', 'error');
                return;
            }
            if (DB.bids.some(item => item.needId === need.id && item.supplierId === supplier.id)) {
                showToast('Your company has already submitted a bid for this procurement need.', 'error');
                return;
            }
            if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
                showToast('Enter a valid offered unit price in Philippine pesos.', 'error');
                return;
            }
            if (!Number.isInteger(leadTimeDays) || leadTimeDays <= 0 || leadTimeDays > 365) {
                showToast('Enter a valid delivery lead time in whole days.', 'error');
                return;
            }
            const termsError = validateSupplierQuotationTerms(quotationTerms);
            if (termsError) {
                showToast(termsError, 'error');
                return;
            }

            const newBid = {
                id: 'BID-' + (3000 + DB.bids.length + 1),
                needId: need.id,
                supplierId: supplier.id,
                supplierName: supplier.name,
                unitPrice,
                totalCost: unitPrice * need.targetQty,
                leadTimeDays,
                notes: notes || quotationTerms.offeredModel,
                quotationTerms,
                submittedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
                status: 'Submitted'
            };

            DB.bids.unshift(newBid);
            logAudit('Bid Submitted', `Supplier ${supplier.name} submitted bid for ${need.id}`);
            Storage.save(DB);
            showToast(`Bid submitted successfully for ${need.title}!`, 'success');
            closeModal();
        });
    }

    const scheduleMeetingForm = document.getElementById('schedule-meeting-form');
    if (scheduleMeetingForm) {
        const getSlot = () => ({
            date: document.getElementById('mtg-date').value,
            time: document.getElementById('mtg-time').value,
            durationMinutes: Number(document.getElementById('mtg-duration').value) || DEFAULT_MEETING_DURATION_MINUTES
        });
        const updateConflictWarning = () => {
            const slot = getSlot();
            const warning = document.getElementById('mtg-conflict-warning');
            const submit = document.getElementById('mtg-submit');
            const conflicts = slot.date && slot.time
                ? findMeetingConflicts(slot, DB.proposalMeetings)
                : [];
            if (warning) {
                warning.classList.toggle('hidden', conflicts.length === 0);
                warning.innerHTML = conflicts.length
                    ? `<i class="fa-solid fa-triangle-exclamation mr-1"></i> <b>Overlapping schedule!</b> This time conflicts with ${conflicts.map(m => `${escapeMeetingText(m.id)} (${escapeMeetingText(m.time)}, ${meetingDuration(m.durationMinutes)} min)`).join(', ')}. Choose another slot or cancel an existing meeting.`
                    : '';
            }
            if (submit) submit.disabled = conflicts.length > 0;
            if (submit) submit.classList.toggle('opacity-50', conflicts.length > 0);
        };
        ['mtg-date', 'mtg-time', 'mtg-duration'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', updateConflictWarning);
            document.getElementById(id)?.addEventListener('change', updateConflictWarning);
        });
        updateConflictWarning();
        scheduleMeetingForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const bid = DB.bids.find(b => b.id === ui.selectedRecord);
            const { date, time, durationMinutes } = getSlot();
            const meetingMode = document.getElementById('mtg-mode').value;
            const venue = document.getElementById('mtg-venue').value.trim();
            const notes = document.getElementById('mtg-notes').value.trim();
            const need = DB.stockNeeds.find(item => item.id === bid?.needId);
            const activeMeetingForBid = DB.proposalMeetings.some(item =>
                item.bidId === bid?.id && ['Pending Response', 'Agreed'].includes(item.status));

            // Validate again on submit: disabling a button is not a security boundary.
            if (findMeetingConflicts({ date, time, durationMinutes }, DB.proposalMeetings).length) {
                updateConflictWarning();
                showToast('This meeting overlaps an existing schedule. Choose another time.', 'warning');
                return;
            }
            if (new Date(`${date}T${time}:00`).getTime() <= Date.now()) {
                showToast('Select a future date and time for the proposal meeting.', 'warning');
                return;
            }
            if (![30, 60, 90, 120].includes(durationMinutes)) {
                showToast('Select a valid meeting duration.', 'error');
                return;
            }
            if (canManageBidding() && bid?.status === 'Selected' && need?.selectedBidId === bid.id &&
                ['Supplier Selected', 'Published'].includes(need.status) &&
                !activeMeetingForBid && !DB.orders.some(order => order.bidId === bid?.id) &&
                date && time && meetingMode && venue) {
                const nextSerial = DB.proposalMeetings.reduce((max, m) => {
                    const match = /^MTG-(\d+)$/.exec(m.id);
                    return match ? Math.max(max, Number(match[1])) : max;
                }, 4000) + 1;
                const newMtg = {
                    id: 'MTG-' + nextSerial,
                    needId: bid.needId,
                    bidId: bid.id,
                    supplierId: bid.supplierId,
                    supplierName: bid.supplierName,
                    date,
                    time,
                    durationMinutes,
                    meetingMode,
                    venue,
                    status: 'Pending Response',
                    notes
                };

                DB.proposalMeetings.unshift(newMtg);
                logAudit('Proposal Meeting Scheduled', `Meeting ${newMtg.id} scheduled with ${bid.supplierName} for ${date} at ${time} (${durationMinutes} minutes)`);
                Storage.save(DB);
                showToast(`Proposal meeting scheduled with ${bid.supplierName}!`, 'success');
                closeModal();
            } else {
                showToast('The proposal meeting could not be scheduled. Verify supplier selection and meeting details.', 'error');
            }
        });
    }

    const cancelMeetingForm = document.getElementById('cancel-meeting-form');
    if (cancelMeetingForm) {
        cancelMeetingForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const reason = document.getElementById('mtg-cancel-reason').value;
            if (cancelProposalMeeting(ui.selectedRecord, reason)) closeModal();
        });
    }

    const finalizeAgreementForm = document.getElementById('finalize-agreement-form');
    if (finalizeAgreementForm) {
        finalizeAgreementForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const bid = DB.bids.find(item => item.id === ui.selectedRecord);
            const need = DB.stockNeeds.find(item => item.id === bid?.needId);
            const pr = DB.requisitions.find(item => item.id === need?.prId);
            const unitPrice = Number(document.getElementById('agreement-unit-price').value);
            const quantity = Number(document.getElementById('agreement-quantity').value);
            const specs = document.getElementById('agreement-specs').value.trim();
            const terms = document.getElementById('agreement-terms').value.trim();

            const blockReason = getAgreementFinalizationError(ui.selectedRecord);
            if (blockReason) {
                showToast(blockReason, 'error');
                return;
            }
            if (!Number.isFinite(unitPrice) || unitPrice < 0) {
                showToast('Enter a valid agreed unit price in Philippine pesos.', 'error');
                return;
            }
            if (!Number.isInteger(quantity) || quantity < 1) {
                showToast('Enter an agreed quantity as a whole number greater than zero.', 'error');
                return;
            }
            if (!specs) {
                showToast('Enter the final specifications and requirements before issuing the Purchase Order.', 'error');
                return;
            }
            if (!terms) {
                showToast('Enter the agreed terms before issuing the Purchase Order.', 'error');
                return;
            }

            const newPO = {
                id: 'PO-' + (5000 + DB.orders.length + 1),
                prId: pr.id,
                needId: need.id,
                bidId: bid.id,
                supplierId: bid.supplierId,
                supplierName: bid.supplierName,
                department: pr.department,
                itemTitle: need.title,
                specs,
                quantity,
                unitPrice,
                totalCost: quantity * unitPrice,
                agreedTerms: terms,
                poDate: new Date().toISOString().substring(0, 10),
                status: 'Awaiting Supplier Signature',
                type: 'Purchase Order',
                createdByName: DB.currentUser.name
            };

            need.status = 'Awarded';
            pr.status = 'In Process';
            DB.orders.unshift(newPO);
            DB.payments.unshift({
                id: 'PAY-' + (9000 + DB.payments.length + 1),
                poId: newPO.id,
                supplierName: bid.supplierName,
                department: pr.department,
                totalAmount: newPO.totalCost,
                deliveryVerified: false,
                paymentAmount: newPO.totalCost,
                paymentMethod: '',
                paymentDate: '',
                status: 'Pending',
                refNumber: '',
                remarks: 'Awaiting supplier signature, delivery, and inspection.'
            });

            logAudit('PO Issued', `Purchase Order ${newPO.id} issued to selected supplier ${bid.supplierName}; awaiting supplier signature.`);
            Storage.save(DB);
            showToast(`Purchase Order ${newPO.id} issued for supplier signature.`, 'success');
            closeModal();
        });
    }
}
