import { HtmlView } from './HtmlView';
import { ui } from '../store/state';
import { renderModalContainer } from '../views/modals';
export function ModalHost() { return ui.currentModal ? <HtmlView html={renderModalContainer()} /> : null; }
