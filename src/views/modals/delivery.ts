// @ts-nocheck
import { closeModal } from '../../actions/modalActions';
import { getRemainingOrderQuantity } from '../../domain/procurement';
import { DB, ui } from '../../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export function renderRecordDeliveryModal() {
    const order = DB.orders.find(o => o.id === ui.selectedRecord);
    const remainingQty = getRemainingOrderQuantity(ui.selectedRecord);
    if (!order || !['Approved & Signed', 'Issued'].includes(order.status) || remainingQty < 1) return '';

    return `
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                    <h3 class="font-bold text-slate-800 text-lg">Log Incoming Shipment</h3>
                    <button data-command="closeModal" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                </div>

                <form id="record-delivery-form" class="space-y-4">
                    <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                        <p class="font-bold text-slate-800">${order.id}: ${order.itemTitle}</p>
                        <p class="text-slate-500 mt-0.5">Vendor: ${order.supplierName} &bull; Ordered Qty: ${order.quantity}</p>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Delivered Qty</label>
                            <input type="number" id="del-qty" min="1" max="${remainingQty}" value="${remainingQty}" required class="w-full text-xs p-2.5 border border-slate-300 rounded-lg">
                        </div>
                        <div>
                            <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Delivery Date</label>
                            <input type="date" id="del-date" required class="w-full text-xs p-2.5 border border-slate-300 rounded-lg">
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Initial Inspection Notes</label>
                        <textarea id="del-notes" rows="3" placeholder="Condition of boxes, package seals, delivery slip #..." class="w-full text-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500"></textarea>
                    </div>

                    <div class="flex justify-end space-x-3 pt-3 border-t border-slate-100">
                        <button type="button" data-command="closeModal" class="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-semibold rounded-lg">Cancel</button>
                        <button type="submit" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm">Save Delivery Record</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}


export function renderInspectDeliveryModal() {
    const delivery = DB.deliveries.find(d => d.id === ui.selectedRecord);
    if (!delivery) return '';

    return `
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200">
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                    <h3 class="font-bold text-slate-800 text-lg">Technical Inspection & Verification</h3>
                    <button data-command="closeModal" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                </div>

                <form id="inspect-delivery-form" class="space-y-4">
                    <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                        <p class="font-bold text-slate-800">${delivery.poId}: ${delivery.itemTitle}</p>
                        <p class="text-slate-500">Delivered: ${delivery.deliveredQty} / ${delivery.orderedQty} units</p>
                        <p class="text-slate-600 font-medium">Specs: ${delivery.specs}</p>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Inspection Outcome</label>
                        <select id="inspect-status" class="w-full text-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500">
                            <option value="Completed - Verified">Completed - Verified (All Items Conform to Specs)</option>
                            <option value="Issue Flagged - Quantity Shortage">Issue Flagged - Quantity Shortage</option>
                            <option value="Issue Flagged - Damaged / Defective Goods">Issue Flagged - Damaged / Defective Goods</option>
                            <option value="Non-Compliant Specifications">Non-Compliant Specifications</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Inspection & Verification Remarks</label>
                        <textarea id="inspect-remarks" rows="3" required placeholder="Detailed verification report, test results, serial numbers..." class="w-full text-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500"></textarea>
                    </div>

                    <div class="flex justify-end space-x-3 pt-3 border-t border-slate-100">
                        <button type="button" data-command="closeModal" class="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-semibold rounded-lg">Cancel</button>
                        <button type="submit" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-sm">Submit Inspection Log</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}
