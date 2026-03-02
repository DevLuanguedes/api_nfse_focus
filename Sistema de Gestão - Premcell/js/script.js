/* ========= Simulação de dados (substitua por chamadas reais) ========= */
const sampleData = [
  { id: 'NF-1001', cliente: 'Empresa A', cnpj: '12.345.678/0001-90', valor: 1200.50, status: 'paid', data: '2025-11-22' },
  { id: 'NF-1002', cliente: 'Loja B', cnpj: '98.765.432/0001-11', valor: 450.00, status: 'pending', data: '2025-11-28' },
  { id: 'NF-1003', cliente: 'Cliente C', cnpj: '11.222.333/0001-55', valor: 2300.00, status: 'paid', data: '2025-12-01' },
  // adicione mais linhas se quiser
];

/* ========= Elementos ========= */
const sidebar = document.getElementById('sidebar');
const btnToggle = document.getElementById('btn-toggle');
const themeToggle = document.getElementById('theme-toggle');
const view = document.getElementById('view');
const breadcrumbs = document.getElementById('breadcrumbs');
const menuItems = document.querySelectorAll('.sidebar li');
const indEmitted = document.getElementById('ind-emitted');
const indPending = document.getElementById('ind-pending');
const indRevenue = document.getElementById('ind-revenue');

/* ========= Estado ========= */
let state = {
  data: sampleData.slice(),
  perPage: 5,
  currentPage: 1,
  sidebarCollapsed: false,
};

/* ========= Inicialização ========= */
document.addEventListener('DOMContentLoaded', () => {
  // sidebar toggle
  btnToggle.addEventListener('click', toggleSidebar);

  // theme auto: toggle class if user clicks (manual override)
  themeToggle.addEventListener('click', () => document.body.classList.toggle('dark'));

  // menu clicks (SPA)
  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.target;
      openView(target);
      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // inicial: home
  openView('home');
  updateIndicators();
});

/* ========= Funções UI ========= */
function toggleSidebar() {
  const el = document.querySelector('.sidebar');
  el.classList.toggle('collapsed');
  state.sidebarCollapsed = el.classList.contains('collapsed');
}

function openView(name) {
  breadcrumbs.textContent = `Home${name !== 'home' ? ' > ' + capitalize(name) : ''}`;
  if (name === 'home') renderHome();
  if (name === 'consultar') renderConsultar();
  if (name === 'emitir') renderEmitir();
  if (name === 'relatorios') renderRelatorios();
}

function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

/* ========= Home ========= */
function renderHome(){
  view.innerHTML = document.querySelector('.home').innerHTML;
  updateIndicators();
}

/* ========= Indicadores (animados com JS simples) ========= */
function updateIndicators(){
  const totalEmitted = state.data.length;
  const totalPending = state.data.filter(d => d.status === 'pending').length;
  const revenue = state.data.reduce((acc, cur) => acc + (Number(cur.valor)||0), 0);

  // anima contador
  animateValue(indEmitted, 0, totalEmitted, 500);
  animateValue(indPending, 0, totalPending, 500);
  animateCurrency(indRevenue, 0, revenue, 600);
}

function animateValue(el, start, end, duration){
  const range = end - start;
  let startTime = null;
  function step(timestamp){
    if(!startTime) startTime = timestamp;
    const progress = Math.min((timestamp - startTime) / duration, 1);
    el.textContent = Math.floor(start + progress * range);
    if(progress < 1) window.requestAnimationFrame(step);
  }
  window.requestAnimationFrame(step);
}

function animateCurrency(el, start, end, duration){
  let startTime = null;
  function step(timestamp){
    if(!startTime) startTime = timestamp;
    const progress = Math.min((timestamp - startTime) / duration, 1);
    const value = start + (end - start) * progress;
    el.textContent = formatMoney(value);
    if(progress < 1) window.requestAnimationFrame(step);
  }
  window.requestAnimationFrame(step);
}

function formatMoney(v){
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* ========= CONSULTAR ========= */
function renderConsultar(){
  view.innerHTML = `
    <div class="panel">
      <h2>Consultar Notas Fiscais</h2>
      <div class="controls">
        <input id="search" class="input search" placeholder="Pesquisar por ID, cliente ou CNPJ">
        <select id="filter-status" class="input">
          <option value="">Todos os status</option>
          <option value="paid">Pagas</option>
          <option value="pending">Pendentes</option>
        </select>
        <select id="per-page" class="input">
          <option value="5">5 por página</option>
          <option value="10">10 por página</option>
          <option value="20">20 por página</option>
        </select>
      </div>

      <div id="table-wrap"></div>
      <div id="pagination" class="pagination"></div>
    </div>
  `;

  // hooks
  document.getElementById('search').addEventListener('input', () => { state.currentPage = 1; renderTable(); });
  document.getElementById('filter-status').addEventListener('change', () => { state.currentPage = 1; renderTable(); });
  document.getElementById('per-page').addEventListener('change', (e) => { state.perPage = Number(e.target.value); state.currentPage = 1; renderTable(); });

  renderTable();
}

function renderTable(){
  const q = document.getElementById('search').value.trim().toLowerCase();
  const status = document.getElementById('filter-status').value;
  let filtered = state.data.filter(d => {
    const matchQ = [d.id, d.cliente, d.cnpj].join(' ').toLowerCase().includes(q);
    const matchStatus = status ? d.status === status : true;
    return matchQ && matchStatus;
  });

  const total = filtered.length;
  const perPage = state.perPage;
  const pages = Math.max(1, Math.ceil(total/perPage));
  if(state.currentPage > pages) state.currentPage = pages;

  const start = (state.currentPage-1)*perPage;
  const paged = filtered.slice(start, start+perPage);

  // build table
  const wrap = document.getElementById('table-wrap');
  let html = `<table class="table">
    <thead><tr>
      <th>ID</th><th>Cliente</th><th>CNPJ</th><th>Valor</th><th>Data</th><th>Status</th><th></th>
    </tr></thead><tbody>`;
  for(const row of paged){
    html += `<tr>
      <td>${row.id}</td>
      <td>${row.cliente}</td>
      <td>${row.cnpj}</td>
      <td>${formatMoney(row.valor)}</td>
      <td>${row.data}</td>
      <td>${row.status === 'paid' ? '<span class="badge paid">Paga</span>' : '<span class="badge pending">Pendente</span>'}</td>
      <td><button class="page-btn" onclick="viewNF('${row.id}')">Ver</button></td>
    </tr>`;
  }
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  // pagination
  const pagWrap = document.getElementById('pagination');
  let phtml = '';
  if(pages > 1){
    if(state.currentPage > 1) phtml += `<button class="page-btn" onclick="changePage(${state.currentPage-1})">Anterior</button>`;
    phtml += `<div style="padding:8px 12px;color:var(--muted)">Página ${state.currentPage} de ${pages}</div>`;
    if(state.currentPage < pages) phtml += `<button class="page-btn" onclick="changePage(${state.currentPage+1})">Próximo</button>`;
  }
  pagWrap.innerHTML = phtml;
}

function changePage(n){ state.currentPage = n; renderTable(); }

function viewNF(id){
  const nf = state.data.find(d => d.id === id);
  if(!nf) return alert('Nota não encontrada');
  openView('consultar'); // ensure we're on consultar
  // show modal-like details (simple)
  view.querySelector('#table-wrap').insertAdjacentHTML('afterend', `
    <div class="panel" id="nf-detail">
      <h3>Detalhes - ${nf.id}</h3>
      <p><strong>Cliente:</strong> ${nf.cliente}</p>
      <p><strong>CNPJ:</strong> ${nf.cnpj}</p>
      <p><strong>Valor:</strong> ${formatMoney(nf.valor)}</p>
      <p><strong>Data:</strong> ${nf.data}</p>
      <p><strong>Status:</strong> ${nf.status}</p>
      <div style="margin-top:10px"><button class="add-btn" onclick="closeDetail()">Fechar</button></div>
    </div>
  `);
}
function closeDetail(){ const el = document.getElementById('nf-detail'); if(el) el.remove(); }

/* ========= EMITIR ========= */
function renderEmitir(){
  breadcrumbs.textContent = 'Home > Emitir Notas';
  view.innerHTML = `
    <div class="panel">
      <h2>Emitir Nota Fiscal</h2>
      <div style="margin-top:10px" class="emit-grid">
        <div>
          <label class="label">Cliente</label>
          <input id="emit-cliente" class="input" placeholder="Razão Social / Nome" />
        </div>
        <div>
          <label class="label">CNPJ / CPF</label>
          <input id="emit-cnpj" class="input" placeholder="00.000.000/0000-00" />
        </div>

        <div>
          <label class="label">Data</label>
          <input id="emit-data" type="date" class="input" />
        </div>
        <div>
          <label class="label">Tipo de NF</label>
          <select id="emit-tipo" class="input">
            <option value="saida">Saída</option>
            <option value="entrada">Entrada</option>
          </select>
        </div>

        <div style="grid-column:1/-1;">
          <label class="label">Itens</label>
          <table class="items-table" id="items-table">
            <thead><tr><th>Descrição</th><th>Qtd</th><th>Unit.</th><th>Valor</th><th></th></tr></thead>
            <tbody id="items-body"></tbody>
          </table>

          <div style="margin-top:8px;">
            <input id="item-desc" class="input" placeholder="Produto / Serviço" style="width:40%;display:inline-block;margin-right:8px;">
            <input id="item-qty" class="input" placeholder="Qtd" style="width:12%;display:inline-block;margin-right:8px;">
            <input id="item-unit" class="input" placeholder="Un" style="width:12%;display:inline-block;margin-right:8px;">
            <input id="item-value" class="input" placeholder="Valor (ex: 120.50)" style="width:20%;display:inline-block;margin-right:8px;">
            <button class="add-btn" id="add-item">Adicionar</button>
          </div>
        </div>

        <div style="grid-column:1/-1; text-align:right; margin-top:10px;">
          <button class="add-btn" id="emit-submit">Emitir Nota</button>
        </div>
      </div>
    </div>
  `;

  // init items
  document.getElementById('items-body').innerHTML = '';
  document.getElementById('add-item').addEventListener('click', addItemToTable);
  document.getElementById('emit-submit').addEventListener('click', submitNF);
}

/* Add item */
function addItemToTable(e){
  e.preventDefault();
  const desc = document.getElementById('item-desc').value.trim();
  const qty = parseFloat(document.getElementById('item-qty').value) || 0;
  const unit = document.getElementById('item-unit').value.trim();
  const value = parseFloat(document.getElementById('item-value').value) || 0;

  if(!desc) return alert('Informe a descrição');
  const tbody = document.getElementById('items-body');
  const idRow = `item-${Date.now()}`;
  const row = document.createElement('tr');
  row.id = idRow;
  row.innerHTML = `<td>${desc}</td><td>${qty}</td><td>${unit}</td><td>${formatMoney(value)}</td>
    <td><button class="remove-btn" onclick="removeItem('${idRow}')">Remover</button></td>`;
  tbody.appendChild(row);

  // limpar campos
  document.getElementById('item-desc').value = '';
  document.getElementById('item-qty').value = '';
  document.getElementById('item-unit').value = '';
  document.getElementById('item-value').value = '';
}

function removeItem(id){
  const el = document.getElementById(id);
  if(el) el.remove();
}

/* Submit NF (simulado) */
function submitNF(){
  const cliente = document.getElementById('emit-cliente').value.trim();
  const cnpj = document.getElementById('emit-cnpj').value.trim();
  const data = document.getElementById('emit-data').value || new Date().toISOString().slice(0,10);
  if(!cliente) return alert('Informe o cliente');

  // calcular valor total a partir dos itens
  const rows = Array.from(document.querySelectorAll('#items-body tr'));
  let total = 0;
  rows.forEach(r => {
    const valorText = r.cells[3].textContent.replace(/\D/g,'');
    // crude parsing: use dataset? but for simplicity, parse last number
    const raw = r.cells[3].textContent.replace(/[R$\s.]/g,'').replace(',', '.');
    const v = parseFloat(raw) || 0;
    total += v;
  });

  // gerar id
  const id = `NF-${Math.floor(Math.random()*9000)+1000}`;
  state.data.unshift({ id, cliente, cnpj, valor: total, status: 'paid', data });
  updateIndicators();

  alert(`Nota ${id} emitida com sucesso. Valor: ${formatMoney(total)}`);
  // voltar para consultar e mostrar página 1
  document.querySelector('[data-target="consultar"]').click();
}

/* ========= RELATÓRIOS (placeholder) ========= */
function renderRelatorios(){
  view.innerHTML = `<div class="panel"><h2>Relatórios</h2><p>Em construção — adicione relatórios e gráficos aqui.</p></div>`;
}

/* ========= Helpers ========= */
/* Expor algumas funções para uso em HTML inline */
window.openView = function(name){
  // set active menu
  document.querySelectorAll('.sidebar li').forEach(li => {
    li.classList.toggle('active', li.dataset.target === name || (name==='home' && li.dataset.target==='home'));
  });
  openView(name);
}
window.changePage = changePage;
window.viewNF = viewNF;
window.closeDetail = closeDetail;

/* ========= Atualizar indicadores toda vez que dados mudarem ========= */
function refreshIfNeeded(){
  // if current view is consultar, re-render table
  if(document.querySelector('#menu-consultar').classList.contains('active')){
    renderTable();
  }
  updateIndicators();
}
