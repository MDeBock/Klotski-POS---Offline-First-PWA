/**
 * Lógica Principal POS - Klotski V5.4 Final (CtaCte + Fast Cash + Split Ref Fix)
 */

const app = {
  db: {
    config: localforage.createInstance({ name: "pos_db", storeName: "configuracion" }),
    productos: localforage.createInstance({ name: "pos_db", storeName: "productos" }),
    cajaActual: localforage.createInstance({ name: "pos_db", storeName: "ventas_actuales" }),
    historial: localforage.createInstance({ name: "pos_db", storeName: "historial_cierres" }),
    ctacte: localforage.createInstance({ name: "pos_db", storeName: "clientes_ctacte" })
  },
  state: {
    cart: [], qty: 1, scannerMode: null, isLaserOn: false, activeScanCode: null,
    html5QrcodeScanner: null, formContext: null, activeManualProduct: null,
    pendingNavTo: null, activeDebtClient: null
  },

  init: async function() { 
    await this.updateHomeTotal(); 
    await this.checkFirstBoot();
  },

  // --- SEGURIDAD: ONBOARDING Y SESIÓN ---
  checkFirstBoot: async function() {
    const savedPin = await this.db.config.getItem('admin_pin_hash');
    if (!savedPin) document.getElementById('modal-setup-pin').classList.remove('hidden');
  },

  saveNewPin: async function() {
    const pin = document.getElementById('setup-pin-input').value;
    if (pin.length < 4) return alert("El PIN debe tener al menos 4 dígitos.");
    await this.db.config.setItem('admin_pin_hash', btoa(pin));
    sessionStorage.setItem('admin_session', 'active');
    document.getElementById('modal-setup-pin').classList.add('hidden');
    alert("¡PIN configurado! Guardalo bien porque encriptará tus backups.");
  },

  requestPin: async function(targetView) {
    if (sessionStorage.getItem('admin_session') === 'active') return this.navTo(targetView);
    this.state.pendingNavTo = targetView;
    document.getElementById('pin-input').value = '';
    document.getElementById('modal-pin').classList.remove('hidden');
    setTimeout(() => document.getElementById('pin-input').focus(), 100);
  },
  cancelPin: function() { document.getElementById('modal-pin').classList.add('hidden'); },
  verifyPin: async function() {
    const input = document.getElementById('pin-input').value;
    const savedPin = await this.db.config.getItem('admin_pin_hash');
    if (btoa(input) === savedPin) {
      sessionStorage.setItem('admin_session', 'active');
      document.getElementById('modal-pin').classList.add('hidden');
      this.navTo(this.state.pendingNavTo);
    } else { alert("PIN Incorrecto."); document.getElementById('pin-input').value = ''; }
  },
  closeAdminSession: function() {
    sessionStorage.removeItem('admin_session');
    this.navTo('view-home');
  },

  openChangePin: function() {
    document.getElementById('cp-old').value = ''; document.getElementById('cp-new').value = '';
    document.getElementById('modal-change-pin').classList.remove('hidden');
  },
  saveChangedPin: async function() {
    const oldPin = document.getElementById('cp-old').value;
    const newPin = document.getElementById('cp-new').value;
    const savedPin = await this.db.config.getItem('admin_pin_hash');
    
    if (btoa(oldPin) !== savedPin) return alert("El PIN actual no coincide.");
    if (newPin.length < 4) return alert("El nuevo PIN debe tener al menos 4 dígitos.");
    
    await this.db.config.setItem('admin_pin_hash', btoa(newPin));
    document.getElementById('modal-change-pin').classList.add('hidden');
    alert("PIN actualizado correctamente.");
  },

  // --- NAVEGACIÓN ---
  navTo: function(viewId) {
    if(this.state.html5QrcodeScanner) { try { this.state.html5QrcodeScanner.stop().catch(e=>{}); } catch(e){} this.state.html5QrcodeScanner = null; }
    document.querySelectorAll('[id^="view-"]').forEach(el => { el.classList.remove('view-active'); el.classList.add('view-hidden'); });
    document.getElementById(viewId).classList.remove('view-hidden'); document.getElementById(viewId).classList.add('view-active');

    if(viewId === 'view-home') this.updateHomeTotal();
    if(viewId === 'view-scanner') this.initScanner('sales', 'reader-sales');
    if(viewId === 'view-inventory') this.renderInventory();
    if(viewId === 'view-inventory-scanner') this.initScanner('inv', 'reader-inv');
    if(viewId === 'view-edit-scanner') this.initScanner('edit', 'reader-edit');
    if(viewId === 'view-caja') this.renderCaja('all');
    if(viewId === 'view-ctacte') this.renderCtaCte();
    if(viewId === 'view-historial') this.renderHistorial();
  },

  // --- ESCÁNER Y SMART SCAN ---
  initScanner: function(mode, elementId) {
    this.state.scannerMode = mode; this.resetLaser();
    this.state.html5QrcodeScanner = new Html5Qrcode(elementId);
    const config = { fps: 15, formatsToSupport: [ Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.UPC_A ] };
    this.state.html5QrcodeScanner.start({ facingMode: "environment" }, config, (text) => this.onScan(text), () => {}).catch(e => alert("Error cámara: " + e));
  },
  fireLaser: function(mode) {
    this.state.isLaserOn = true;
    const btn = document.getElementById(`btn-trigger-${mode}`); const overlay = document.getElementById(`overlay-${mode}`); const container = document.getElementById(`cam-container-${mode}`);
    if(overlay) overlay.classList.add('hidden');
    if(btn) { btn.innerHTML = '🔄 LEYENDO...'; btn.classList.replace('btn-3d', 'active:scale-95'); }
    if(container) container.classList.add('border-active-laser');
  },
  resetLaser: function() {
    this.state.isLaserOn = false; const mode = this.state.scannerMode;
    const btn = document.getElementById(`btn-trigger-${mode}`); const overlay = document.getElementById(`overlay-${mode}`); const container = document.getElementById(`cam-container-${mode}`);
    if(overlay) overlay.classList.remove('hidden');
    if(btn) { btn.innerHTML = '🎯 DISPARAR LÁSER'; btn.classList.replace('active:scale-95', 'btn-3d'); }
    if(container) container.classList.remove('border-active-laser');
  },

  onScan: async function(decodedText) {
    if(!this.state.isLaserOn) return;
    if(!document.getElementById('modal-product-form').classList.contains('hidden')) return;
    if(navigator.vibrate) navigator.vibrate([100]);
    this.resetLaser();

    const product = await this.db.productos.getItem(decodedText);

    if (this.state.scannerMode === 'sales') {
      if (product) {
        const isBulk = product.code.startsWith('MANUAL-') || (product.pres||'').toLowerCase().includes('kg') || (product.pres||'').toLowerCase().includes('granel');
        
        if(isBulk) {
          this.openQtyInput(product);
        } else {
          this.addToCart(product, this.state.qty);
          this.state.qty = 1; this.updateQtyUI();
        }
      } else {
        this.openProductForm(decodedText, 'sales');
      }
    } else if (this.state.scannerMode === 'inv') {
      if (product) alert("El producto ya existe en inventario."); else this.openProductForm(decodedText, 'inv');
    } else if (this.state.scannerMode === 'edit') {
      if (product) this.openProductForm(decodedText, 'edit', product); else alert("Producto no encontrado.");
    }
  },

  // --- CARRITO EDICIÓN ---
  changeQty: function(val) { if(this.state.qty + val > 0) { this.state.qty += val; this.updateQtyUI(); } },
  updateQtyUI: function() { document.getElementById('qty-display').innerText = this.state.qty; },
  addToCart: function(product, qty) {
    const q = parseFloat(qty) || 1; const existing = this.state.cart.find(i => i.code === product.code);
    if (existing) existing.qty += q; else this.state.cart.push({ ...product, qty: q });
    this.updateCartSummary();
  },
  updateCartSummary: function() { const total = this.state.cart.reduce((acc, i) => acc + (i.precio * i.qty), 0); document.getElementById('scan-total').innerText = total.toFixed(2); },
  openCart: function() { if(this.state.cart.length === 0) return; this.renderCartItems(); document.getElementById('modal-cart').classList.remove('hidden'); },
  closeCart: function() { document.getElementById('modal-cart').classList.add('hidden'); },
  modifyCartQty: function(index, delta) {
    const item = this.state.cart[index]; const newQty = item.qty + delta;
    if(newQty > 0) { item.qty = newQty; } else { this.state.cart.splice(index, 1); }
    this.updateCartSummary(); if(this.state.cart.length === 0) this.closeCart(); else this.renderCartItems();
  },
  removeCartItem: function(index) { this.state.cart.splice(index, 1); this.updateCartSummary(); if(this.state.cart.length === 0) this.closeCart(); else this.renderCartItems(); },
  renderCartItems: function() {
    const container = document.getElementById('cart-items'); container.innerHTML = '';
    this.state.cart.forEach((item, index) => {
      const isDecimal = !Number.isInteger(item.qty);
      container.innerHTML += `
        <div class="bg-gray-50 p-4 rounded-xl border flex flex-col gap-2 shadow-sm">
          <div class="flex justify-between items-start">
            <div><div class="font-black">${item.nombre}</div><div class="text-xs text-gray-500 font-bold">$${(item.precio||0).toFixed(2)} / ${item.pres||'u'}</div></div>
            <div class="font-black text-xl text-blue-600">$${(item.qty * (item.precio||0)).toFixed(2)}</div>
          </div>
          <div class="flex justify-between items-center mt-2 border-t pt-2">
            <div class="flex items-center gap-3 bg-white border rounded-lg p-1">
              <button onclick="app.modifyCartQty(${index}, ${isDecimal ? -0.5 : -1})" class="w-8 h-8 bg-gray-100 rounded text-xl font-black active:bg-gray-200">-</button>
              <div class="font-black w-10 text-center">${isDecimal ? item.qty.toFixed(2) : item.qty}</div>
              <button onclick="app.modifyCartQty(${index}, ${isDecimal ? 0.5 : 1})" class="w-8 h-8 bg-gray-100 rounded text-xl font-black active:bg-gray-200">+</button>
            </div>
            <button onclick="app.removeCartItem(${index})" class="bg-red-50 text-red-600 px-3 py-2 rounded-lg font-bold text-sm">Eliminar</button>
          </div>
        </div>`;
    });
    document.getElementById('cart-btn-total').innerText = document.getElementById('scan-total').innerText;
  },

  // --- MANUAL / GRANEL ---
  createManualProduct: function() { const manualCode = "MANUAL-" + Date.now(); this.openProductForm(manualCode, 'inv'); },
  openManualCatalog: function() { document.getElementById('catalog-search').value = ''; this.renderCatalog(''); document.getElementById('modal-catalog').classList.remove('hidden'); },
  renderCatalog: async function(searchTerm = '') {
    const container = document.getElementById('catalog-list'); container.innerHTML = ''; const products = [];
    await this.db.productos.iterate((v) => { products.push(v); });
    const term = (searchTerm || '').toString().toLowerCase();
    const filtered = products.filter(p => { const n = (p.nombre||'').toLowerCase(); const c = (p.code||'').toLowerCase(); return n.includes(term) || c.includes(term); });
    filtered.forEach(p => {
      container.innerHTML += `<button onclick='app.openQtyInput(${JSON.stringify(p)})' class="w-full bg-gray-50 p-4 rounded-xl border flex justify-between items-center mb-2 active:bg-blue-50 text-left"><div><div class="font-black text-lg">${p.nombre}</div><div class="text-sm font-bold text-gray-500">${p.pres||'u'}</div></div><div class="font-black text-blue-600">$${(p.precio||0).toFixed(2)}</div></button>`;
    });
    if(filtered.length === 0) container.innerHTML = '<div class="p-4 text-center text-gray-400 font-bold">No encontrado.</div>';
  },
  openQtyInput: function(product) {
    this.state.activeManualProduct = product; document.getElementById('mq-title').innerText = product.nombre; document.getElementById('mq-price').innerText = `$${product.precio.toFixed(2)} por ${product.pres || 'unidad'}`;
    const input = document.getElementById('mq-input'); input.value = ''; document.getElementById('modal-qty-input').classList.remove('hidden'); setTimeout(() => input.focus(), 100);
  },
  confirmManualAdd: function() {
    const rawVal = document.getElementById('mq-input').value; const qtyFloat = parseFloat(rawVal);
    if(isNaN(qtyFloat) || qtyFloat <= 0) return alert("Ingresa un número válido.");
    this.addToCart(this.state.activeManualProduct, qtyFloat); document.getElementById('modal-qty-input').classList.add('hidden'); document.getElementById('modal-catalog').classList.add('hidden');
  },

  // --- MODIFICADO: SPLIT PAYMENTS CON FAST CASH ---
  openPayment: function() {
    document.getElementById('pay-cash-in').value = ''; 
    document.getElementById('pay-trans-in').value = ''; 
    document.getElementById('pay-fiado-in').value = '';
    document.getElementById('pay-trans-ref').value = ''; 
    document.getElementById('pay-fiado-ref').value = '';
    
    const total = this.state.cart.reduce((acc, i) => acc + (i.precio * i.qty), 0);
    document.getElementById('pay-total-display').innerText = total.toFixed(2);
    
    this.calcSplitPayment(); 
    document.getElementById('modal-payment').classList.remove('hidden');
  },
  
  closePayment: function() { document.getElementById('modal-payment').classList.add('hidden'); },
  
  calcSplitPayment: function() {
    const total = parseFloat(document.getElementById('pay-total-display').innerText);
    const cash = parseFloat(document.getElementById('pay-cash-in').value) || 0;
    const trans = parseFloat(document.getElementById('pay-trans-in').value) || 0;
    const fiado = parseFloat(document.getElementById('pay-fiado-in').value) || 0;
    const remaining = total - (cash + trans + fiado);
    
    document.getElementById('pay-remaining').innerText = Math.abs(remaining).toFixed(2);
    const btn = document.getElementById('btn-confirm-payment');
    if(Math.abs(remaining) < 0.01) { 
      btn.disabled = false; btn.classList.replace('bg-gray-400', 'bg-klo-green'); btn.innerText = "Confirmar Cobro";
      if(remaining < -0.01) btn.innerText = `Dar Vuelto: $${Math.abs(remaining).toFixed(2)}`;
    } else {
      btn.disabled = true; btn.classList.replace('bg-klo-green', 'bg-gray-400'); btn.innerText = "Saldar Total";
    }
  },

  fastCashPayment: async function() {
    const totalCart = this.state.cart.reduce((acc, i) => acc + (i.precio * i.qty), 0);
    const sale = { 
      id: Date.now().toString(), 
      date: new Date().toISOString(), 
      items: [...this.state.cart], 
      total: totalCart, 
      type: 'efectivo',
      methods: [{ type: 'efectivo', amount: totalCart }] 
    };
    
    await this.db.cajaActual.setItem(sale.id, sale);
    this.state.cart = []; 
    this.updateCartSummary(); 
    this.closePayment(); 
    this.closeCart(); 
    alert("¡Cobro Rápido Exitoso!");
  },

  registerDebt: async function(clientName, amount) {
    const nameKey = clientName.trim().toUpperCase();
    let client = await this.db.ctacte.getItem(nameKey);
    if(!client) client = { name: clientName.trim(), debt: 0, lastUpdate: new Date().toISOString() };
    client.debt += amount;
    client.lastUpdate = new Date().toISOString();
    await this.db.ctacte.setItem(nameKey, client);
  },

  confirmSplitPayment: async function() {
    const cash = parseFloat(document.getElementById('pay-cash-in').value) || 0;
    const trans = parseFloat(document.getElementById('pay-trans-in').value) || 0;
    const fiado = parseFloat(document.getElementById('pay-fiado-in').value) || 0;
    const refT = document.getElementById('pay-trans-ref').value.trim();
    const refF = document.getElementById('pay-fiado-ref').value.trim();
    
    if(trans > 0 && !refT) return alert("Falta Referencia de Transferencia");
    if(fiado > 0 && !refF) return alert("Falta Cliente para Fiado");

    const totalCart = this.state.cart.reduce((acc, i) => acc + (i.precio * i.qty), 0);
    let methods = [];
    if(cash > 0) methods.push({ type: 'efectivo', amount: cash }); 
    if(trans > 0) methods.push({ type: 'transferencia', amount: trans, ref: refT });
    
    if(fiado > 0) {
      methods.push({ type: 'fiado', amount: fiado, ref: refF });
      await this.registerDebt(refF, fiado);
    }

    const sale = { id: Date.now().toString(), date: new Date().toISOString(), items: [...this.state.cart], total: totalCart, type: methods.length > 1 ? 'múltiple' : methods[0].type, methods: methods };
    await this.db.cajaActual.setItem(sale.id, sale);
    this.state.cart = []; this.updateCartSummary(); this.closePayment(); this.closeCart(); alert("¡Venta Exitosa!");
  },

  // --- GESTIÓN DE CUENTAS CORRIENTES ---
  renderCtaCte: async function(searchTerm = '') {
    const container = document.getElementById('ctacte-list'); container.innerHTML = ''; const clients = [];
    await this.db.ctacte.iterate(v => { if(v.debt > 0) clients.push(v); }); 
    const term = (searchTerm||'').toLowerCase();
    const filtered = clients.filter(c => c.name.toLowerCase().includes(term));
    
    filtered.sort((a,b) => b.debt - a.debt).forEach(c => {
      container.innerHTML += `
        <button onclick='app.openPayDebt(${JSON.stringify(c)})' class="w-full bg-white p-4 rounded-xl border flex justify-between items-center mb-3 active:bg-orange-50 text-left shadow-sm">
          <div><div class="font-black text-gray-800 text-lg">${c.name}</div><div class="text-xs text-gray-500 font-bold mt-1">Últ. act: ${new Date(c.lastUpdate).toLocaleDateString()}</div></div>
          <div class="font-black text-xl text-klo-orange">$${c.debt.toFixed(2)}</div>
        </button>`;
    });
    if(filtered.length === 0) container.innerHTML = '<div class="text-center text-gray-400 font-bold p-4">No hay deudores pendientes.</div>';
  },

  openPayDebt: function(client) {
    this.state.activeDebtClient = client;
    document.getElementById('pd-name').innerText = client.name;
    document.getElementById('pd-debt').innerText = client.debt.toFixed(2);
    document.getElementById('pd-amount').value = '';
    document.getElementById('modal-pay-debt').classList.remove('hidden');
    setTimeout(() => document.getElementById('pd-amount').focus(), 100);
  },

  confirmDebtPayment: async function() {
    const amt = parseFloat(document.getElementById('pd-amount').value);
    const method = document.getElementById('pd-method').value;
    const client = this.state.activeDebtClient;
    
    if(isNaN(amt) || amt <= 0 || amt > client.debt) return alert("Monto inválido. Ingrese un número menor o igual a la deuda.");
    
    client.debt -= amt;
    client.lastUpdate = new Date().toISOString();
    await this.db.ctacte.setItem(client.name.toUpperCase(), client);
    
    const record = {
      id: "cobro_deuda_" + Date.now(),
      date: new Date().toISOString(),
      items: [{ nombre: "Cobro Deuda Cta.Cte.", qty: 1, precio: amt }],
      total: amt,
      type: method,
      ref: client.name,
      isDebtPayment: true
    };
    await this.db.cajaActual.setItem(record.id, record);
    
    this.updateHomeTotal();
    document.getElementById('modal-pay-debt').classList.add('hidden');
    this.renderCtaCte(document.getElementById('ctacte-search').value);
    alert(`Se registraron $${amt.toFixed(2)} a la Caja.`);
  },

  // --- FORMULARIOS PRODUCTO ---
  openProductForm: function(code, context, existingData = null) {
    this.state.activeScanCode = code; this.state.formContext = context; document.getElementById('prod-form-code').innerText = code;
    if(existingData) {
      document.getElementById('prod-form-title').innerText = "Editar Producto";
      document.getElementById('pf-marca').value = existingData.marca || ''; document.getElementById('pf-nombre').value = existingData.nombre || ''; document.getElementById('pf-pres').value = existingData.pres || ''; document.getElementById('pf-precio').value = existingData.precio || '';
    } else {
      document.getElementById('prod-form-title').innerText = "Nuevo Producto"; ['pf-marca', 'pf-nombre', 'pf-pres', 'pf-precio'].forEach(id => document.getElementById(id).value = '');
    }
    document.getElementById('modal-product-form').classList.remove('hidden');
  },
  closeProductForm: function() { document.getElementById('modal-product-form').classList.add('hidden'); if(this.state.scannerMode === 'edit') this.navTo('view-inventory'); this.state.qty = 1; this.updateQtyUI(); },
  saveProductForm: async function() {
    const code = this.state.activeScanCode;
    const p = { code, marca: document.getElementById('pf-marca').value.trim(), nombre: document.getElementById('pf-nombre').value.trim(), pres: document.getElementById('pf-pres').value.trim(), precio: parseFloat(document.getElementById('pf-precio').value) };
    if(!p.nombre || !p.pres || isNaN(p.precio)) return alert('Nombre, Presentación y Precio obligatorios.');
    await this.db.productos.setItem(code, p); this.closeProductForm();
    if(this.state.formContext === 'sales') { this.addToCart(p, this.state.qty); this.state.qty = 1; this.updateQtyUI(); } 
    else if(this.state.formContext === 'inv') { alert("Producto guardado."); this.navTo('view-inventory'); } 
    else if(this.state.formContext === 'edit') { this.renderInventory(document.getElementById('inv-search').value); }
  },

  // --- MODIFICADO: CAJA CON NOMBRES EN REFERENCIA ---
  updateHomeTotal: async function() { let total = 0; await this.db.cajaActual.iterate(v => { total += (v.total || 0); }); document.getElementById('home-total-caja').innerText = total.toFixed(2); },
  
  renderCaja: async function(filter) {
    document.querySelectorAll('.filter-caja').forEach(b => { b.classList.replace('bg-gray-800', 'bg-gray-100'); b.classList.replace('text-white', 'text-gray-600'); });
    event.target.classList.replace('bg-gray-100', 'bg-gray-800'); event.target.classList.replace('text-gray-600', 'text-white');
    const container = document.getElementById('caja-list'); container.innerHTML = ''; const sales = [];
    await this.db.cajaActual.iterate(v => { sales.push(v); });
    
    const filtered = filter === 'all' ? sales : sales.filter(s => { if(s.type === 'múltiple') return s.methods.some(m => m.type === filter); return s.type === filter; });
    
    filtered.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(s => {
      let displayAmount = s.total;
      let titlePrefix = s.type.toUpperCase();
      let isPartial = false;
      let activeRef = '';
      
      if(s.type === 'múltiple' && filter !== 'all') {
        const methodInfo = s.methods.find(m => m.type === filter);
        if(methodInfo) {
          displayAmount = methodInfo.amount;
          isPartial = true;
          titlePrefix = filter.toUpperCase();
          activeRef = methodInfo.ref || '';
        }
      } else if (s.type !== 'múltiple') {
        activeRef = s.methods ? (s.methods[0]?.ref || '') : (s.ref || '');
      }

      let icon = '💵'; if(titlePrefix.toLowerCase()==='transferencia') icon='🏦'; if(titlePrefix.toLowerCase()==='fiado') icon='📝'; if(titlePrefix.toLowerCase()==='múltiple') icon='💳';
      
      let details = '';
      if(s.type === 'múltiple' && filter === 'all') {
        details = s.methods.map(m => `${m.type.toUpperCase()}: $${m.amount}${m.ref ? ' ('+m.ref+')' : ''}`).join(' | ');
      } else {
        details = activeRef ? `Ref: ${activeRef}` : '';
        if(isPartial) {
          details = `Parcial (Ticket $${s.total.toFixed(2)})${details ? ' | ' + details : ''}`;
        }
      }

      if(s.isDebtPayment) { icon = '📒'; titlePrefix = 'COBRO DEUDA ' + s.type.toUpperCase(); details = `Cliente: ${s.ref}`; }

      container.innerHTML += `
        <div class="bg-white p-4 rounded-xl shadow-sm border flex justify-between items-center">
          <div>
            <div class="font-black text-gray-800">${icon} ${titlePrefix} ${isPartial?'<span class="text-[10px] bg-yellow-100 text-yellow-800 px-2 py-1 rounded ml-1">PARCIAL</span>':''}</div>
            <div class="text-[10px] text-gray-500 font-bold uppercase mt-1">${details}</div>
            <div class="text-xs text-gray-400 mt-1">${new Date(s.date).toLocaleTimeString()}</div>
          </div>
          <div class="font-black text-xl text-gray-900">$${(displayAmount||0).toFixed(2)}</div>
        </div>`;
    });
    if(filtered.length === 0) container.innerHTML = '<div class="text-center text-gray-400 font-bold p-4 mt-10">No hay ventas registradas.</div>';
  },
  
  confirmCierreCaja: async function() {
    const sales = []; let total = 0; await this.db.cajaActual.iterate(v => { sales.push(v); total += (v.total || 0); });
    if(sales.length === 0) return alert("Caja vacía.");
    if(confirm(`¿Cerrar caja?\nTransacciones: ${sales.length}\nTotal: $${total.toFixed(2)}`)) {
      const c = { id: "cierre_"+Date.now(), date: new Date().toISOString(), total: total, records: sales };
      await this.db.historial.setItem(c.id, c); await this.db.cajaActual.clear(); this.updateHomeTotal(); alert("Caja archivada.");
    }
  },

  // --- MODIFICADO: ADMIN E HISTORIAL CON REFERENCIAS ---
  renderHistorial: async function() {
    const container = document.getElementById('historial-list'); container.innerHTML = ''; const cierres = [];
    await this.db.historial.iterate(v => { cierres.push(v); });
    cierres.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(c => {
      container.innerHTML += `<button onclick="app.openHistorialDetail('${c.id}')" class="w-full bg-white p-4 rounded-xl shadow-sm border flex justify-between items-center mb-2 active:bg-gray-50"><div class="text-left"><div class="font-black text-gray-800">Cierre Turno</div><div class="text-xs text-gray-500 font-bold mt-1">${new Date(c.date).toLocaleString()}</div></div><div class="font-black text-xl text-pink-600">$${(c.total||0).toFixed(2)}</div></button>`;
    });
    if(cierres.length === 0) container.innerHTML = '<div class="text-center text-gray-400 p-4 mt-10">Sin cierres.</div>';
  },
  
  openHistorialDetail: async function(id) {
    const c = await this.db.historial.getItem(id);
    document.getElementById('hd-date').innerText = new Date(c.date).toLocaleString(); document.getElementById('hd-total').innerText = (c.total || 0).toFixed(2);
    const container = document.getElementById('hd-list'); container.innerHTML = '';
    c.records.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(s => {
      let icon = '💵'; if(s.type==='transferencia') icon='🏦'; if(s.type==='fiado') icon='📝'; if(s.type==='múltiple') icon='💳';
      
      let details = '';
      if(s.type === 'múltiple') {
        details = s.methods.map(m => `${m.type.toUpperCase()}: $${m.amount}${m.ref ? ' ('+m.ref+')' : ''}`).join(' | ');
      } else {
        details = s.methods ? (s.methods[0]?.ref || '') : (s.ref || '');
        details = details ? `Ref: ${details}` : '';
      }

      if(s.isDebtPayment) { icon = '📒'; details = `Cliente: ${s.ref}`; }

      container.innerHTML += `<div class="bg-white p-3 rounded-lg border flex justify-between items-center mb-2 shadow-sm"><div><div class="font-bold text-gray-800 text-sm">${icon} ${s.type.toUpperCase()}</div><div class="text-[10px] text-gray-500 font-bold uppercase">${details}</div><div class="text-xs text-gray-400 mt-1">${new Date(s.date).toLocaleTimeString()}</div></div><div class="font-black">$${(s.total || 0).toFixed(2)}</div></div>`;
    });
    document.getElementById('modal-historial-detail').classList.remove('hidden');
  },
  
  renderInventory: async function(searchTerm = '') {
    const container = document.getElementById('inv-list'); container.innerHTML = ''; const products = [];
    await this.db.productos.iterate(v => { products.push(v); });
    const term = (searchTerm||'').toString().toLowerCase();
    const filtered = products.filter(p => { return (p.nombre||'').toLowerCase().includes(term) || (p.code||'').toLowerCase().includes(term); });
    filtered.forEach(p => {
      container.innerHTML += `<div class="bg-white p-4 rounded-xl border flex justify-between items-center mb-3"><div class="flex-1 mr-4"><div class="font-black text-gray-800">${p.nombre}</div><div class="text-xs text-gray-500 mt-1">${p.pres||'-'} | Cód: ${p.code}</div><div class="font-black text-lg text-blue-600 mt-1">$${(p.precio||0).toFixed(2)}</div></div><div class="flex space-x-2 shrink-0"><button class="bg-blue-50 text-blue-600 w-12 h-12 rounded-xl font-bold active:bg-blue-100" onclick='app.openProductForm("${p.code}", "edit", ${JSON.stringify(p)})'>✏️</button><button class="bg-red-50 text-red-600 w-12 h-12 rounded-xl font-bold active:bg-red-100" onclick='app.deleteProduct("${p.code}")'>🗑️</button></div></div>`;
    });
  },
  deleteProduct: async function(code) { if(confirm('¿Eliminar producto permanentemente?')) { await this.db.productos.removeItem(code); this.renderInventory(document.getElementById('inv-search').value); } },

  // --- EXPORTACIONES Y CRYPTO BACKUPS ---
  exportCSV: async function(tipo) {
    let data = []; let filename = "";
    if(tipo === 'productos') {
      await this.db.productos.iterate(v => data.push({ Codigo: v.code, Marca: v.marca||'', Nombre: v.nombre||'', Presentacion: v.pres||'', Precio: v.precio||0 }));
      filename = "Productos_Export.csv";
    } else if (tipo === 'ventas') {
      const cierres = []; await this.db.historial.iterate(v => cierres.push(v));
      cierres.forEach(c => { c.records.forEach(r => { data.push({ Fecha: new Date(r.date).toLocaleString(), Turno_ID: c.id, Tipo_Pago: r.type, Total: r.total||0, Cantidad_Articulos: r.items.length }); }); });
      filename = "Ventas_Historial_Export.csv";
    }
    if(data.length === 0) return alert("No hay datos para exportar.");
    const headers = Object.keys(data[0]); const csvRows = [headers.join(',')];
    data.forEach(row => { csvRows.push(headers.map(field => `"${String(row[field]).replace(/"/g, '""')}"`).join(',')); });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  },

  exportEncryptedBackup: async function() {
    const pin = prompt("Por seguridad, ingresa tu PIN maestro para ENCRIPTAR este archivo de backup:");
    if(!pin) return;
    
    const savedPin = await this.db.config.getItem('admin_pin_hash');
    if (btoa(pin) !== savedPin) return alert("PIN Incorrecto. Exportación cancelada.");

    const dbDump = { productos: [], caja_actual: [], historial: [], ctacte: [] };
    await this.db.productos.iterate(v => { dbDump.productos.push(v); }); 
    await this.db.cajaActual.iterate(v => { dbDump.caja_actual.push(v); }); 
    await this.db.historial.iterate(v => { dbDump.historial.push(v); });
    await this.db.ctacte.iterate(v => { dbDump.ctacte.push(v); });
    
    const jsonString = JSON.stringify(dbDump);
    const encryptedData = CryptoJS.AES.encrypt(jsonString, pin).toString();
    
    const blob = new Blob([encryptedData], { type: 'text/plain' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `Seguro_DB_${Date.now()}.bak`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    alert("Backup Encriptado descargado.\nNadie podrá leer su contenido sin el PIN.");
  },

  importEncryptedBackup: function(event) {
    const file = event.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const encryptedData = e.target.result;
      const pin = prompt("Ingrese el PIN con el que se protegió este archivo de Backup:");
      if(!pin) { event.target.value = ''; return; }

      try {
        const bytes = CryptoJS.AES.decrypt(encryptedData, pin);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        
        if(!decryptedString) throw new Error("Clave Incorrecta");
        
        const data = JSON.parse(decryptedString);
        if(!data.productos || !data.historial) throw new Error("JSON Corrupto");
        
        if(confirm(`Desencriptación exitosa. Se fusionarán ${data.productos.length} productos y ${data.historial.length} turnos a tu base actual omitiendo duplicados. ¿Proceder?`)) {
          for(let p of data.productos) await this.db.productos.setItem(p.code, p);
          for(let h of data.historial) await this.db.historial.setItem(h.id, h);
          if(data.caja_actual) for(let c of data.caja_actual) await this.db.cajaActual.setItem(c.id, c);
          if(data.ctacte) for(let c of data.ctacte) await this.db.ctacte.setItem(c.name.toUpperCase(), c);
          alert("Base de datos restaurada exitosamente."); location.reload();
        }
      } catch(error) { 
        alert("Error de Restauración: La clave ingresada es incorrecta o el archivo está dañado."); 
      }
      event.target.value = ''; 
    };
    reader.readAsText(file);
  }
};

window.onload = () => app.init();