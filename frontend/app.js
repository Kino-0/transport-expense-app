// 1. Supabaseクライアントのインポート
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
let supabase;
let supabaseInitializationError = null;
try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (error) {
    supabaseInitializationError = `Supabaseクライアントの初期化に失敗しました: ${error.message}`;
    console.error(supabaseInitializationError);
}

// 3. ステータスIDの定数定義
const STATUS_PENDING = 1; // 申請中
const STATUS_REJECTED = 2; // 修正依頼
const STATUS_APPROVED = 3; // 承認済
const STATUS_PAID = 4; // 領収済
const STATUS_DELETED = 9; // 削除

/**
 * 4. APIサービスクラス
 * Supabaseとの通信（RPC呼び出し）を担当します。
 */
class ApiService {
    constructor(supabaseClient) {
        if (!supabaseClient) {
            throw new Error("Supabase client is not initialized.");
        }
        this.supabase = supabaseClient;
    }

    async login(empCode) {
        const { data: userInfo, error } = await this.supabase
            .rpc('get_user_details', { p_emp_code: empCode })
            .maybeSingle();

        if (error) throw new Error(`ユーザー情報の取得に失敗しました: ${error.message}`);
        if (!userInfo) throw new Error(`ユーザーが見つかりません: ${empCode}`);

        return {
            empCode: userInfo.emp_code,
            empName: userInfo.emp_name,
            deptName: userInfo.dept_name
        };
    }

    async fetchHistory(empCode) {
        const { data: historyList, error } = await this.supabase
            .rpc('get_expense_history', { p_emp_code: empCode });
        if (error) throw new Error(`申請履歴の取得に失敗しました: ${error.message}`);
        return historyList;
    }

    async fetchDetails(applId) {
        const { data, error } = await this.supabase
            .rpc('get_expense_details', { p_appl_id: applId })
            .maybeSingle();
        if (error) throw new Error(`申請詳細の取得に失敗しました: ${error.message}`);
        if (!data) throw new Error(`申請詳細が見つかりません: ${applId}`);
        return data;
    }

    async submitApplication(empCode, detailsData) {
        const { data: newApplId, error } = await this.supabase
            .rpc('submit_expense_application', {
                p_emp_code: empCode,
                p_details: detailsData
            });
        if (error) throw new Error(`申請処理に失敗しました: ${error.message}`);
        return { success: true, appl_id: newApplId };
    }
}

/**
 * 5. UIマネージャークラス
 * DOMの操作、レンダリング、UIイベント（表示/非表示など）を担当します。
 */
class UIManager {
    constructor() {
        this.dom = {};
        this.cacheDom();
        this.rowTemplate = this.dom.rowTemplate.content;
    }

    // DOM要素をキャッシュ
    cacheDom() {
        const $ = (id) => document.getElementById(id);
        this.dom = {
            loginScreen: $('login-screen'),
            loginButton: $('login-button'),
            empIdInput: $('emp-id'),
            loginError: $('login-error'),
            mainScreen: $('main-screen'),
            logoutButton: $('logout-button'),
            userNameSpan: $('user-name'),
            userDeptSpan: $('user-dept'),
            navContainer: $('nav-container'),
            tableBody: $('table-body'),
            historyTableBody: $('history-table-body'),
            addRowButton: $('add-row-button'),
            submitButton: $('submit-button'),
            submitMessage: $('submit-error'),
            rowTemplate: $('row-template'),
            pages: document.querySelectorAll('.page-content'),
            navTabs: document.querySelectorAll('.nav-tab'),
            detailsModal: $('details-modal'),
            modalOverlay: $('modal-overlay'),
            modalCloseButtonHeader: $('modal-close-button-header'),
            modalCloseButtonFooter: $('modal-close-button-footer'),
            modalApplId: $('modal-appl-id'),
            modalEmpName: $('modal-emp-name'),
            modalDeptName: $('modal-dept-name'),
            modalApplDate: $('modal-appl-date'),
            modalStatus: $('modal-status'),
            modalDetailsTableBody: $('modal-details-table-body'),
            modalTotalAmount: $('modal-total-amount')
        };
    }

    // 汎用UI操作
    show(element) { element?.classList.remove('hidden'); }
    hide(element) { element?.classList.add('hidden'); }

    setLoading(button, isLoading, loadingText = "処理中...") {
        if (!button) return;
        const originalText = button.dataset.originalText || button.textContent;
        if (isLoading) {
            if (!button.dataset.originalText) button.dataset.originalText = originalText;
            button.disabled = true;
            button.textContent = loadingText;
        } else {
            button.disabled = false;
            button.textContent = button.dataset.originalText || originalText;
            delete button.dataset.originalText;
        }
    }

    showMessage(element, message, isError = true) {
        if (!element) return;
        element.innerHTML = message.replace(/\n/g, '<br>');
        element.classList.toggle('text-red-500', isError);
        element.classList.toggle('text-green-600', !isError);
        this.show(element);
    }
    hideMessage(element) {
        if (!element) return;
        element.textContent = '';
        this.hide(element);
    }

    // 画面切り替え
    toggleMainScreen(isLoggedIn) {
        this.hide(isLoggedIn ? this.dom.loginScreen : this.dom.mainScreen);
        this.show(isLoggedIn ? this.dom.mainScreen : this.dom.loginScreen);
        if (!isLoggedIn) this.dom.empIdInput.value = '';
    }

    switchPage(pageId) {
        this.dom.pages.forEach(page => this.hide(page));
        this.show(document.getElementById(pageId));

        this.dom.navTabs.forEach(tab => {
            const isTarget = tab.dataset.target === pageId;
            tab.classList.toggle('border-indigo-500', isTarget);
            tab.classList.toggle('text-indigo-600', isTarget);
            tab.classList.toggle('border-transparent', !isTarget);
            tab.classList.toggle('text-gray-500', !isTarget);
        });
    }

    updateUserInfo(user) {
        this.dom.userNameSpan.textContent = user.empName || '';
        this.dom.userDeptSpan.textContent = user.deptName || '';
    }

    // 新規申請フォーム
    createRow() {
        const tr = this.rowTemplate.cloneNode(true).firstElementChild;
        this.dom.tableBody.appendChild(tr);
    }

    updateLineTotal(tr) {
        const unitPrice = parseInt(tr.querySelector('[data-role="unitPrice"]').value, 10) || 0;
        const isRoundTrip = tr.querySelector('[data-role="isRoundTrip"]').checked;
        const total = unitPrice * (isRoundTrip ? 2 : 1);
        const totalElement = tr.querySelector('[data-role="lineTotal"]');
        if (totalElement) {
            totalElement.textContent = total.toLocaleString() + ' 円';
        }
    }

    resetApplicationForm() {
        this.dom.tableBody.innerHTML = '';
        this.createRow();
        this.hideMessage(this.dom.submitMessage);
    }

    highlightErrorField(inputElement) {
        if (inputElement) {
            inputElement.setAttribute('aria-invalid', 'true');
            inputElement.focus();
        }
    }

    resetErrorHighlights() {
        this.dom.tableBody.querySelectorAll('input[aria-invalid="true"]')
            .forEach(input => input.removeAttribute('aria-invalid'));
        this.hideMessage(this.dom.submitMessage);
    }

    getStatusBadgeClass(status_id) {
        const baseClass = 'px-3 py-1 text-xs font-semibold rounded-full';
        switch (status_id) {
            case STATUS_PENDING: return `${baseClass} bg-blue-100 text-blue-800`;
            case STATUS_APPROVED: case STATUS_PAID: return `${baseClass} bg-green-100 text-green-800`;
            case STATUS_REJECTED: return `${baseClass} bg-yellow-100 text-yellow-800`;
            case STATUS_DELETED: return `${baseClass} bg-red-100 text-red-800`;
            default: return `${baseClass} bg-gray-100 text-gray-800`;
        }
    }

    // 履歴・詳細
    renderHistory(historyData) {
        const tbody = this.dom.historyTableBody;
        if (!historyData || historyData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">申請履歴はありません。</td></tr>';
            return;
        }

        tbody.innerHTML = historyData.map(item => {
            const statusBadge = `<span class="${this.getStatusBadgeClass(item.status_id)}">${item.status}</span>`;
            const detailButton = `<button class="text-indigo-600 hover:text-indigo-800" data-appl-id="${item.id}">詳細</button>`;
            return `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-sm text-gray-700 font-mono" title="${item.id}">${item.id}</td>
                    <td class="px-4 py-3 text-sm text-gray-700">${item.date}</td>
                    <td class="px-4 py-3 text-sm text-gray-900 font-medium text-right">${item.total.toLocaleString()} 円</td>
                    <td class="px-4 py-3 text-sm">${statusBadge}</td>
                    <td class="px-4 py-3 text-sm">${detailButton}</td>
                </tr>
            `;
        }).join('');
    }

    showDetailsModal(data) {
        // ヘッダー情報
        this.dom.modalApplId.textContent = data.appl_id || '';
        this.dom.modalEmpName.textContent = data.emp_name || '';
        this.dom.modalDeptName.textContent = data.dept_name || '';
        this.dom.modalApplDate.textContent = data.appl_date || '';
        this.dom.modalTotalAmount.textContent = (data.total_amount || 0).toLocaleString() + ' 円';
        this.dom.modalStatus.innerHTML = `<span class="${this.getStatusBadgeClass(data.status_id)}">${data.status_name || '不明'}</span>`;

        // 明細テーブル
        const tbody = this.dom.modalDetailsTableBody;
        if (!data.details || data.details.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-gray-500">明細はありません。</td></tr>';
        } else {
            tbody.innerHTML = data.details.map(item => `
                <tr>
                    <td class="px-4 py-3 text-sm text-gray-700">${item.use_date}</td>
                    <td class="px-4 py-3 text-sm text-gray-700">${item.purpose}</td>
                    <td class="px-4 py-3 text-sm text-gray-700">${item.line_name}</td>
                    <td class="px-4 py-3 text-sm text-gray-700">${item.dep_station}</td>
                    <td class="px-4 py-3 text-sm text-gray-700">${item.arr_station}</td>
                    <td class="px-4 py-3 text-sm text-gray-700 text-right">${item.unit_price.toLocaleString()}</td>
                    <td class="px-4 py-3 text-sm text-gray-700 text-center font-bold text-indigo-600">${item.is_round_trip ? '✓' : ''}</td>
                    <td class="px-4 py-3 text-sm text-gray-900 font-medium text-right">${item.line_total.toLocaleString()} 円</td>
                </tr>
            `).join('');
        }
        this.show(this.dom.detailsModal);
    }

    hideDetailsModal() {
        this.hide(this.dom.detailsModal);
    }
}

/**
 * 6. アプリケーションコントローラークラス
 * イベントハンドリングと状態管理、ビジネスロジックを担当します。
 */
class AppController {
    constructor(supabaseClient, initializationError) {
        this.state = { currentUser: null };
        this.ui = new UIManager();

        if (initializationError) {
            this.ui.showMessage(this.ui.dom.loginError, initializationError);
            this.ui.dom.loginButton.disabled = true;
            return;
        }

        this.api = new ApiService(supabaseClient);
        this.bindEvents();
        this.ui.toggleMainScreen(false);
    }

    bindEvents() {
        this.ui.dom.loginButton.addEventListener('click', () => this.handleLogin());
        this.ui.dom.logoutButton.addEventListener('click', () => this.handleLogout());
        this.ui.dom.navContainer.addEventListener('click', (e) => this.handleNavClick(e));
        this.ui.dom.addRowButton.addEventListener('click', () => this.ui.createRow());
        this.ui.dom.submitButton.addEventListener('click', () => this.handleSubmit());

        const tableBody = this.ui.dom.tableBody;
        tableBody.addEventListener('input', (e) => this.handleTableEvent(e));
        tableBody.addEventListener('change', (e) => this.handleTableEvent(e));
        tableBody.addEventListener('click', (e) => this.handleTableClick(e));
        this.ui.dom.historyTableBody.addEventListener('click', (e) => this.handleShowDetails(e));

        [this.ui.dom.modalOverlay,
        this.ui.dom.modalCloseButtonHeader,
        this.ui.dom.modalCloseButtonFooter].forEach(el => {
            el?.addEventListener('click', () => this.ui.hideDetailsModal());
        });
    }

    // --- イベントハンドラ ---

    async handleLogin() {
        const empCode = this.ui.dom.empIdInput.value.trim();
        if (!empCode) {
            this.ui.showMessage(this.ui.dom.loginError, "従業員コードを入力してください。");
            return;
        }

        this.ui.setLoading(this.ui.dom.loginButton, true, "ログイン中...");
        this.ui.hideMessage(this.ui.dom.loginError);

        try {
            const userData = await this.api.login(empCode);
            this.state.currentUser = userData;
            this.ui.updateUserInfo(userData);
            this.ui.toggleMainScreen(true);
            this.ui.switchPage('history-screen'); // デフォルトを履歴に
            this.loadHistory();
        } catch (error) {
            console.error("ログインエラー:", error);
            this.ui.showMessage(this.ui.dom.loginError, error.message);
        } finally {
            this.ui.setLoading(this.ui.dom.loginButton, false);
        }
    }

    handleLogout() {
        this.state.currentUser = null;
        this.ui.updateUserInfo({});
        this.ui.toggleMainScreen(false);
    }

    handleNavClick(e) {
        const tab = e.target.closest('.nav-tab');
        if (!tab || !tab.dataset.target) return;

        const pageId = tab.dataset.target;
        this.ui.switchPage(pageId);

        if (pageId === 'history-screen') this.loadHistory();
        if (pageId === 'main-content' && this.ui.dom.tableBody.rows.length === 0) {
            this.ui.createRow();
        }
    }

    handleTableEvent(e) {
        const tr = e.target.closest('tr');
        if (!tr) return;
        const role = e.target.dataset.role;
        if ((role === 'unitPrice' && e.type === 'input') || (role === 'isRoundTrip' && e.type === 'change')) {
            this.ui.updateLineTotal(tr);
        }
    }

    handleTableClick(e) {
        const deleteButton = e.target.closest('[data-role="deleteRow"]');
        if (!deleteButton) return;

        const tr = deleteButton.closest('tr');
        if (!tr) return;

        tr.remove();
    }

    async handleShowDetails(e) {
        const button = e.target.closest('button[data-appl-id]');
        if (!button) return;

        this.ui.setLoading(button, true, "読込中");
        try {
            const detailsData = await this.api.fetchDetails(button.dataset.applId);
            this.ui.showDetailsModal(detailsData);
        } catch (error) {
            console.error("詳細の読み込みエラー:", error);
            alert(`詳細の取得に失敗しました: ${error.message}`);
        } finally {
            this.ui.setLoading(button, false);
        }
    }

    async handleSubmit() {
        this.ui.setLoading(this.ui.dom.submitButton, true, "申請処理中...");
        this.ui.resetErrorHighlights();

        const detailsData = this.collectAndValidateDetails();
        if (detailsData === null) {
            this.ui.setLoading(this.ui.dom.submitButton, false);
            return;
        }

        try {
            await this.api.submitApplication(this.state.currentUser.empCode, detailsData);
            this.ui.showMessage(this.ui.dom.submitMessage, "申請が完了しました。", false);
            setTimeout(() => this.ui.hideMessage(this.ui.dom.submitMessage), 3000);

            this.ui.resetApplicationForm();
            this.ui.switchPage('history-screen');
            this.loadHistory();
        } catch (error) {
            console.error("申請処理エラー:", error);
            this.ui.showMessage(this.ui.dom.submitMessage, `申請に失敗しました: ${error.message}`);
        } finally {
            this.ui.setLoading(this.ui.dom.submitButton, false);
        }
    }

    // --- データ処理 ---

    async loadHistory() {
        const tbody = this.ui.dom.historyTableBody;
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">読み込み中...</td></tr>';
        try {
            const historyData = await this.api.fetchHistory(this.state.currentUser.empCode);
            this.ui.renderHistory(historyData);
        } catch (error) {
            console.error("履歴の読み込みエラー:", error);
            tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500">履歴の読み込みに失敗しました: ${error.message}</td></tr>`;
        }
    }

    collectAndValidateDetails() {
        const detailsData = [];
        const allErrors = [];
        const rows = this.ui.dom.tableBody.querySelectorAll('tr');

        for (let i = 0; i < rows.length; i++) {
            const tr = rows[i];
            const getVal = (role) => tr.querySelector(`[data-role="${role}"]`)?.value.trim() ?? '';
            const getChecked = (role) => tr.querySelector(`[data-role="${role}"]`)?.checked ?? false;
            const getNum = (role) => parseInt(tr.querySelector(`[data-role="${role}"]`)?.value, 10) || 0;
            const getInput = (role) => tr.querySelector(`[data-role="${role}"]`);

            const values = {
                useDate: getVal('useDate'),
                purpose: getVal('purpose'),
                lineName: getVal('lineName'),
                departure: getVal('departure'),
                arrival: getVal('arrival'),
                unitPrice: getNum('unitPrice'),
                isRoundTrip: getChecked('isRoundTrip')
            };

            const isRowEmpty = !values.useDate && !values.purpose && !values.lineName &&
                !values.departure && !values.arrival && values.unitPrice === 0;
            if (isRowEmpty) continue;

            const rowErrors = [];
            // 検証ヘルパー
            const checkRule = (value, inputRole, msg) => {
                if (!value) {
                    rowErrors.push(msg);
                    this.ui.highlightErrorField(getInput(inputRole));
                }
            };

            // バリデーションの実行
            checkRule(values.useDate, 'useDate', `${i + 1}行目: 日付を入力してください。`);
            checkRule(values.purpose, 'purpose', `${i + 1}行目: 業務・訪問先を入力してください。`);
            checkRule(values.lineName, 'lineName', `${i + 1}行目: 利用路線を入力してください。`);
            checkRule(values.departure, 'departure', `${i + 1}行目: 区間(出発)を入力してください。`);
            checkRule(values.arrival, 'arrival', `${i + 1}行目: 区間(到着)を入力してください。`);

            if (values.unitPrice <= 0) {
                rowErrors.push(`${i + 1}行目: 単価は1以上の数値を入力してください。`);
                this.ui.highlightErrorField(getInput('unitPrice'));
            }

            if (rowErrors.length > 0) {
                allErrors.push(...rowErrors);
            } else {
                // バリデーション通過
                detailsData.push({
                    use_date: values.useDate, purpose: values.purpose, line_name: values.lineName,
                    dep_station: values.departure, arr_station: values.arrival,
                    unit_price: values.unitPrice, is_round_trip: values.isRoundTrip,
                });
            }
        }

        if (allErrors.length > 0) {
            this.ui.showMessage(this.ui.dom.submitMessage, allErrors.join('\n'));
            return null;
        }
        if (detailsData.length === 0) {
            this.ui.showMessage(this.ui.dom.submitMessage, "申請するデータがありません。");
            return null;
        }
        return detailsData;
    }
}

// 7. アプリケーションの実行
document.addEventListener('DOMContentLoaded', () => {
    new AppController(supabase, supabaseInitializationError);
});
