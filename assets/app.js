(() => {
  'use strict';
  const API = (window.HAMIKAR_API_BASE || '').replace(/\/$/, '');
  const tokenKey = 'hamikar_session_token';
  const userKey = 'hamikar_session_user';
  const faDigits = value => String(value || '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const token = () => localStorage.getItem(tokenKey) || '';
  const readUser = () => { try { return JSON.parse(localStorage.getItem(userKey) || 'null'); } catch { return null; } };
  const status = (form, message, error = false) => { const node = form.querySelector('[role="status"]'); if (node) { node.textContent = message; node.style.color = error ? '#b42318' : '#21764d'; } };
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (token()) headers.set('Authorization', 'Bearer ' + token());
    let response;
    try { response = await fetch(API + path, { ...options, headers }); }
    catch { throw new Error('اتصال به سرور برقرار نشد. API هنوز راه‌اندازی نشده یا نشانی آن تنظیم نیست.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'درخواست انجام نشد.');
    return data;
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const statusNames = { REQUESTED:'ثبت درخواست', UNDER_REVIEW:'در حال بررسی', QUOTED:'اعلام هزینه', AWAITING_PAYMENT:'در انتظار پرداخت', IN_PROGRESS:'در حال انجام', COMPLETED:'تکمیل‌شده', CANCELLED:'لغوشده' };
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.mobile-toggle'), links = document.querySelector('.navlinks');
    if (toggle && links) toggle.addEventListener('click', () => { const open = links.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); });
    document.querySelectorAll('[data-auth]').forEach(form => form.addEventListener('submit', async event => {
      event.preventDefault(); const button = form.querySelector('[type=submit]'); if (button) button.disabled = true;
      const fields = Object.fromEntries(new FormData(form).entries()); fields.phone = faDigits(fields.phone).replace(/[\s\-]/g, '');
      try {
        const data = await api('/api/auth/' + form.dataset.auth, { method:'POST', body:JSON.stringify(fields) });
        localStorage.setItem(tokenKey, data.token); localStorage.setItem(userKey, JSON.stringify(data.user));
        location.href = data.user.role === 'ADMIN' || data.user.role === 'EXPERT' ? 'admin.html' : 'dashboard.html';
      } catch(error) { status(form, error.message, true); } finally { if (button) button.disabled = false; }
    }));
    document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', () => { localStorage.removeItem(tokenKey); localStorage.removeItem(userKey); location.href = 'login.html'; }));
    const orderForm = document.querySelector('[data-order-form]');
    if (orderForm) {
      if (!token()) location.replace('login.html?next=dashboard');
      const user = readUser(); const welcome = document.querySelector('#welcome'); if (welcome && user?.fullName) welcome.textContent = 'سلام ' + user.fullName + '، درخواست‌های شما';
      const select = orderForm.querySelector('[data-services]');
      api('/api/services').then(data => { select.innerHTML = '<option value="">انتخاب خدمت</option>' + data.services.map(s => '<option value="' + esc(s.id) + '">' + esc(s.title) + (s.pricingType === 'FIXED' && s.priceRial ? ' — ' + esc(Number(s.priceRial)/10) + ' تومان' : ' — هزینه پس از بررسی') + '</option>').join(''); }).catch(error => { select.innerHTML = '<option value="">خدمات بارگذاری نشد</option>'; status(orderForm, error.message, true); });
      orderForm.addEventListener('submit', async event => {
        event.preventDefault(); const button = orderForm.querySelector('[type=submit]'); button.disabled = true;
        try { const data = Object.fromEntries(new FormData(orderForm).entries()); data.acceptedTerms = orderForm.elements.acceptedTerms.checked; await api('/api/orders', {method:'POST',body:JSON.stringify(data)}); orderForm.reset(); status(orderForm,'درخواست شما ثبت شد.'); await loadOrders(); }
        catch(error) { status(orderForm,error.message,true); } finally { button.disabled = false; }
      });
      loadOrders();
    }
    async function loadOrders() {
      const holder = document.querySelector('[data-orders]'); if (!holder) return;
      try {
        const data = await api('/api/orders');
        holder.innerHTML = data.orders.length ? data.orders.map(o => '<article class="card order-card"><strong>' + esc(o.service?.title || 'خدمت') + '</strong><p>' + esc(statusNames[o.status] || o.status) + '</p><small>کد پیگیری: ' + esc(o.id) + '</small><p>' + esc(o.details) + '</p><small>' + esc(new Date(o.createdAt).toLocaleDateString('fa-IR')) + '</small></article>').join('') : '<p class="note">هنوز درخواستی ثبت نکرده‌اید.</p>';
      } catch(error) { holder.innerHTML = '<p class="note">' + esc(error.message) + '</p>'; }
    }
    const admin = document.querySelector('[data-admin-orders]');
    if (admin) {
      const user = readUser();
      if (!token()) { location.replace('login.html'); return; }
      if (!user || !['ADMIN','EXPERT'].includes(user.role)) { admin.innerHTML = '<p class="note">این بخش فقط برای مدیر یا کارشناس مجاز است.</p>'; return; }
      api('/api/orders').then(data => {
        admin.innerHTML = data.orders.length ? '<div class="table-wrap"><table><thead><tr><th>کد</th><th>خدمت</th><th>وضعیت</th><th>شرح</th><th>تغییر وضعیت</th></tr></thead><tbody>' + data.orders.map(o => '<tr><td>' + esc(o.id) + '</td><td>' + esc(o.service?.title) + '</td><td>' + esc(statusNames[o.status] || o.status) + '</td><td>' + esc(o.details) + '</td><td><form data-status-form data-id="' + esc(o.id) + '"><select name="status">' + Object.entries(statusNames).map(([key,label]) => '<option value="' + key + '"' + (key === o.status ? ' selected' : '') + '>' + label + '</option>').join('') + '</select><input name="quoteRial" type="number" min="1" step="1" placeholder="مبلغ به ریال" aria-label="مبلغ پیشنهادی به ریال"><button class="btn btn-navy" type="submit">ثبت</button></form></td></tr>').join('') + '</tbody></table></div>' : '<p class="note">پرونده‌ای وجود ندارد.</p>';
      }).catch(error => { admin.innerHTML = '<p class="note">' + esc(error.message) + '</p>'; });
      admin.addEventListener('submit', async event => {
        const form = event.target.closest('[data-status-form]'); if (!form) return; event.preventDefault();
        const button = form.querySelector('button'); button.disabled = true;
        try { await api('/api/orders/' + encodeURIComponent(form.dataset.id) + '/status', {method:'PATCH',body:JSON.stringify({status:form.elements.status.value,quoteRial:form.elements.quoteRial.value ? Number(form.elements.quoteRial.value) : undefined})}); const msg = document.querySelector('[role=status]'); if(msg) msg.textContent = 'وضعیت پرونده به‌روزرسانی شد.'; location.reload(); }
        catch(error) { const msg = document.querySelector('[role=status]'); if(msg) {msg.textContent = error.message; msg.style.color='#b42318';} button.disabled = false; }
      });
    }
  });
})();