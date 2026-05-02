// ===== CONSTANTS =====
const PROJECTS = ['สุวรรณภูมิ', 'นวนคร DC6', 'สุขวิท'];
const STATUSES = ['รอดำเนินการ', 'กำลังตรวจสอบ', 'กำลังซ่อม', 'รอชิ้นส่วน', 'เสร็จสิ้น', 'ยกเลิก'];
const ROLES = ['admin', 'ช่าง', 'ช่างซ่อม', 'ผู้แจ้ง', 'ผู้บริหาร'];
const LINE_SERVER = 'http://localhost:5001';

// ===== STATE =====
let currentUser = null;
let allRepairs = [];
let chartStatus = null;
let chartProject = null;

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// ===== AUTH =====
auth.onAuthStateChanged(async user => {
  if (!user) { window.location.href = 'index.html'; return; }
  try {
    const doc = await db.collection('users').doc(user.uid).get();
    if (!doc.exists || doc.data().disabled) {
      await auth.signOut();
      window.location.href = 'index.html';
      return;
    }
    currentUser = { uid: user.uid, email: user.email, ...doc.data() };
    initApp();
  } catch (e) {
    console.error('Profile load error:', e);
    await auth.signOut();
    window.location.href = 'index.html';
  }
});

function initApp() {
  renderNav();
  document.getElementById('user-name').textContent = currentUser.displayName || currentUser.email;
  document.getElementById('user-role').textContent = currentUser.role;

  document.getElementById('nr-images').addEventListener('change', e => {
    const preview = document.getElementById('nr-preview');
    preview.innerHTML = '';
    Array.from(e.target.files).slice(0, 5).forEach(f => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.onclick = () => openImageModal(img.src);
      preview.appendChild(img);
    });
  });

  document.getElementById('new-repair-form').addEventListener('submit', async e => {
    e.preventDefault();
    await submitNewRepair();
  });

  window.addEventListener('popstate', () => handleRoute(window.location.hash));
  handleRoute(window.location.hash || '#dashboard');
}

// ===== NAVIGATION =====
function handleRoute(hash) {
  const parts = (hash || '#dashboard').replace('#', '').split('/');
  const view = parts[0] || 'dashboard';
  const id = parts[1] || null;
  navigate(view, { id }, false);
}

function navigate(view, params = {}, pushState = true) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('d-none'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.remove('d-none');

  if (pushState) {
    const hash = params.id ? `#${view}/${params.id}` : `#${view}`;
    history.pushState({ view, params }, '', hash);
  }

  document.querySelectorAll('#sidebar-menu .nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });

  const titles = {
    dashboard: 'ภาพรวมงานซ่อม',
    'new-repair': 'แจ้งซ่อมเครื่องจักร',
    detail: 'รายละเอียดงานซ่อม',
    admin: 'ตั้งค่าระบบ',
    reports: 'รายงาน'
  };
  document.getElementById('topbar-title').textContent = titles[view] || '';
  const actionsEl = document.getElementById('topbar-actions');
  actionsEl.innerHTML = '';
  if (view === 'dashboard') {
    actionsEl.innerHTML = `<button class="btn btn-sm btn-primary" onclick="navigate('new-repair')">
      <i class="bi bi-plus-lg me-1"></i>แจ้งซ่อมใหม่</button>`;
  }

  if (view === 'dashboard') loadDashboard();
  else if (view === 'detail' && params.id) loadDetail(params.id);
  else if (view === 'admin') loadAdmin();
  else if (view === 'reports') initReports();
  else if (view === 'new-repair') resetNewRepairForm();
}

// ===== SIDEBAR =====
function renderNav() {
  const role = currentUser.role;
  const canAdmin = role === 'admin';
  const canReports = role === 'admin' || role === 'ผู้บริหาร';

  const links = [
    { view: 'dashboard',  icon: 'bi-speedometer2', label: 'ภาพรวม',   show: true },
    { view: 'new-repair', icon: 'bi-plus-circle',  label: 'แจ้งซ่อม', show: true },
    { view: 'reports',    icon: 'bi-bar-chart',    label: 'รายงาน',   show: canReports },
    { view: 'admin',      icon: 'bi-gear',         label: 'ตั้งค่า',  show: canAdmin },
  ];

  document.getElementById('sidebar-menu').innerHTML = links
    .filter(l => l.show)
    .map(l => `<a class="nav-link" href="#" data-view="${l.view}" onclick="navigate('${l.view}');return false;">
      <i class="bi ${l.icon}"></i>${l.label}</a>`)
    .join('');
}

async function doLogout() {
  await auth.signOut();
  window.location.href = 'index.html';
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('show');
}

// ===== HELPERS =====
function statusBadge(s) {
  return `<span class="status-badge status-${s}">${s}</span>`;
}

function urgencyBadge(u) {
  const cls = { 'ด่วนมาก': 'badge-urgency-high', 'ด่วน': 'badge-urgency-medium', 'ปกติ': 'badge-urgency-low' };
  const icon = { 'ด่วนมาก': '🔴', 'ด่วน': '🟠', 'ปกติ': '🟢' };
  return `<span class="badge rounded-pill ${cls[u]||''}">${icon[u]||''}${u}</span>`;
}

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateShort(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function showToast(msg, type = 'success') {
  const id = 'toast-' + Date.now();
  const bg = { success: 'bg-success', error: 'bg-danger', warn: 'bg-warning text-dark', info: 'bg-info' }[type] || 'bg-success';
  document.getElementById('toast-container').insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center ${bg} text-white border-0 mb-2" role="alert">
      <div class="d-flex">
        <div class="toast-body">${msg}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  new bootstrap.Toast(document.getElementById(id), { delay: 4000 }).show();
}

function openImageModal(src) {
  document.getElementById('modal-image-src').src = src;
  new bootstrap.Modal(document.getElementById('modal-image')).show();
}

// ===== REPAIR NUMBER GENERATOR =====
async function generateRepairNumber() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const counterRef = db.collection('counters').doc('repairs');
  return db.runTransaction(async tx => {
    const doc = await tx.get(counterRef);
    const counts = doc.exists ? (doc.data().counts || {}) : {};
    const next = (counts[ym] || 0) + 1;
    counts[ym] = next;
    tx.set(counterRef, { counts }, { merge: true });
    return `REP-${ym}-${String(next).padStart(3, '0')}`;
  });
}

// ===== LINE NOTIFICATION (optional — silently skips if server offline) =====
async function notifyLine(event, repair) {
  try {
    await fetch(`${LINE_SERVER}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, repair })
    });
  } catch (e) {
    console.warn('LINE notify skipped (server offline?):', e.message);
  }
}

// ===== DASHBOARD =====
async function loadDashboard() {
  try {
    const snap = await db.collection('repairs').orderBy('createdAt', 'desc').limit(200).get();
    allRepairs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const role = currentUser.role;
    let visible = allRepairs;
    if (role === 'ผู้แจ้ง') {
      visible = allRepairs.filter(r => r.reporterUid === currentUser.uid);
    }

    updateStats(visible);
    renderRepairsTable(visible);
  } catch (e) {
    console.error('loadDashboard error:', e);
    document.getElementById('repairs-table-body').innerHTML =
      `<tr><td colspan="9" class="text-center py-3 text-danger">เกิดข้อผิดพลาด: ${e.message}</td></tr>`;
  }
}

function updateStats(repairs) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  document.getElementById('stat-pending').textContent =
    repairs.filter(r => r.status === 'รอดำเนินการ').length;
  document.getElementById('stat-inprogress').textContent =
    repairs.filter(r => ['กำลังตรวจสอบ', 'กำลังซ่อม'].includes(r.status)).length;
  document.getElementById('stat-waiting').textContent =
    repairs.filter(r => r.status === 'รอชิ้นส่วน').length;
  document.getElementById('stat-done').textContent =
    repairs.filter(r => r.status === 'เสร็จสิ้น' && r.completedAt &&
      (r.completedAt.toDate ? r.completedAt.toDate() : new Date(r.completedAt)) >= startOfMonth).length;
}

function renderRepairsTable(repairs) {
  const tbody = document.getElementById('repairs-table-body');
  document.getElementById('repairs-count').textContent = `${repairs.length} รายการ`;

  if (!repairs.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">ไม่พบข้อมูล</td></tr>';
    return;
  }

  tbody.innerHTML = repairs.map(r => `
    <tr onclick="navigate('detail',{id:'${r.id}'})" style="cursor:pointer">
      <td><code class="text-primary">${r.repairNumber || '-'}</code></td>
      <td>${r.machine || '-'}</td>
      <td><span class="badge bg-light text-dark">${r.project || '-'}</span></td>
      <td class="text-muted" style="max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">
        ${r.symptoms || '-'}
      </td>
      <td>${urgencyBadge(r.urgency)}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="text-muted small">${r.reporterName || '-'}</td>
      <td class="text-muted small">${fmtDateShort(r.createdAt)}</td>
      <td class="text-muted small">${r.assignedToName || '<span class="text-muted">ยังไม่มอบหมาย</span>'}</td>
    </tr>`).join('');
}

function applyFilters() {
  const proj = document.getElementById('f-project').value;
  const stat = document.getElementById('f-status').value;
  const urg = document.getElementById('f-urgency').value;
  const q = document.getElementById('f-search').value.toLowerCase();

  const role = currentUser.role;
  let base = allRepairs;
  if (role === 'ผู้แจ้ง') base = allRepairs.filter(r => r.reporterUid === currentUser.uid);

  const result = base.filter(r => {
    if (proj && r.project !== proj) return false;
    if (stat && r.status !== stat) return false;
    if (urg && r.urgency !== urg) return false;
    if (q) {
      const haystack = `${r.machine} ${r.repairNumber} ${r.symptoms} ${r.reporterName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  renderRepairsTable(result);
}

function clearFilters() {
  ['f-project', 'f-status', 'f-urgency'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-search').value = '';
  applyFilters();
}

// ===== NEW REPAIR =====
function resetNewRepairForm() {
  document.getElementById('new-repair-form').reset();
  document.getElementById('nr-preview').innerHTML = '';
}

async function submitNewRepair() {
  const btn = document.getElementById('btn-submit-repair');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังส่ง...';

  try {
    const machine = document.getElementById('nr-machine').value.trim();
    const project = document.getElementById('nr-project').value;
    const location = document.getElementById('nr-location').value.trim();
    const urgency = document.querySelector('input[name="urgency"]:checked').value;
    const symptoms = document.getElementById('nr-symptoms').value.trim();
    const note = document.getElementById('nr-note').value.trim();
    const files = document.getElementById('nr-images').files;

    if (!machine || !project || !symptoms) {
      showToast('กรุณากรอกข้อมูลที่จำเป็น', 'error');
      return;
    }

    const repairNumber = await generateRepairNumber();

    const imageUrls = [];
    for (let i = 0; i < Math.min(files.length, 5); i++) {
      try {
        const ref = storage.ref(`repairs/${repairNumber}/${Date.now()}_${files[i].name}`);
        await ref.put(files[i]);
        imageUrls.push(await ref.getDownloadURL());
      } catch (imgErr) {
        console.warn('Image upload failed:', imgErr.message);
      }
    }

    const data = {
      repairNumber,
      machine,
      project,
      location,
      urgency,
      symptoms,
      note,
      imageUrls,
      status: 'รอดำเนินการ',
      reporterUid: currentUser.uid,
      reporterName: currentUser.displayName || currentUser.email,
      assignedToUid: null,
      assignedToName: null,
      completedAt: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('repairs').add(data);
    await notifyLine('new_repair', { ...data, repairNumber });

    showToast(`ส่งใบแจ้งซ่อม ${repairNumber} เรียบร้อยแล้ว`, 'success');
    navigate('dashboard');
  } catch (e) {
    console.error('submitNewRepair error:', e);
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-send me-1"></i>ส่งใบแจ้งซ่อม';
  }
}

// ===== DETAIL =====
async function loadDetail(repairId) {
  const el = document.getElementById('detail-content');
  el.innerHTML = '<div class="text-center py-5"><span class="spinner-border text-primary"></span></div>';

  try {
    const [repDoc, logsSnap] = await Promise.all([
      db.collection('repairs').doc(repairId).get(),
      db.collection('repair_logs').where('repairId', '==', repairId)
        .orderBy('timestamp', 'asc').get()
    ]);

    if (!repDoc.exists) { el.innerHTML = '<div class="alert alert-danger">ไม่พบข้อมูล</div>'; return; }

    const r = { id: repairId, ...repDoc.data() };
    const logs = logsSnap.docs.map(d => d.data());

    const role = currentUser.role;
    const canUpdate = ['admin', 'ช่าง', 'ช่างซ่อม'].includes(role);
    const canAssign = role === 'admin';
    const canCancel = role === 'admin' || (r.reporterUid === currentUser.uid && r.status === 'รอดำเนินการ');

    const statusOptions = role === 'admin'
      ? STATUSES
      : ['กำลังตรวจสอบ', 'กำลังซ่อม', 'รอชิ้นส่วน', 'เสร็จสิ้น'];

    const imagesHtml = (r.imageUrls || []).length
      ? `<div class="img-preview-wrap">${(r.imageUrls).map(u =>
          `<img src="${u}" onclick="openImageModal('${u}')" title="ดูรูป">`).join('')}</div>`
      : '<span class="text-muted small">ไม่มีรูปภาพ</span>';

    const updatePanel = canUpdate && r.status !== 'เสร็จสิ้น' && r.status !== 'ยกเลิก' ? `
      <div class="card mb-3">
        <div class="card-header bg-primary text-white py-2">
          <i class="bi bi-pencil-square me-1"></i>อัปเดตสถานะ
        </div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label small fw-medium">สถานะใหม่</label>
              <select class="form-select form-select-sm" id="upd-status">
                ${statusOptions.filter(s => s !== r.status).map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-8">
              <label class="form-label small fw-medium">หมายเหตุ</label>
              <input type="text" class="form-control form-control-sm" id="upd-note" placeholder="บันทึกรายละเอียด...">
            </div>
          </div>

          <div class="mt-3">
            <label class="form-label small fw-medium">วัสดุ/อะไหล่ที่ใช้</label>
            <div id="materials-list"></div>
            <button class="btn btn-sm btn-outline-secondary mt-1" onclick="addMaterialRow()">
              <i class="bi bi-plus me-1"></i>เพิ่มวัสดุ
            </button>
          </div>

          <div class="mt-3">
            <button class="btn btn-sm btn-primary" onclick="submitUpdate('${repairId}','${r.project}','${r.machine}','${r.repairNumber}')">
              <i class="bi bi-check-circle me-1"></i>บันทึก
            </button>
            ${canCancel ? `<button class="btn btn-sm btn-outline-danger ms-2" onclick="cancelRepair('${repairId}')">ยกเลิกใบแจ้งซ่อม</button>` : ''}
          </div>
        </div>
      </div>` : '';

    const assignPanel = canAssign ? `
      <button class="btn btn-sm btn-outline-primary" onclick="openAssignModal('${repairId}')">
        <i class="bi bi-person-check me-1"></i>
        ${r.assignedToName ? 'เปลี่ยนช่าง' : 'มอบหมายช่าง'}
      </button>` : '';

    el.innerHTML = `
      <div class="mb-3 d-flex align-items-center gap-2 flex-wrap">
        <button class="btn btn-sm btn-outline-secondary" onclick="navigate('dashboard')">
          <i class="bi bi-arrow-left me-1"></i>กลับ
        </button>
        <code class="text-primary fs-6">${r.repairNumber || '-'}</code>
        ${statusBadge(r.status)}
        ${urgencyBadge(r.urgency)}
        ${assignPanel}
      </div>

      <div class="row g-3">
        <div class="col-lg-8">
          <div class="card mb-3">
            <div class="card-header py-2">ข้อมูลใบแจ้งซ่อม</div>
            <div class="card-body">
              <div class="row g-2 small">
                <div class="col-6"><span class="text-muted">เครื่องจักร:</span><br><strong>${r.machine||'-'}</strong></div>
                <div class="col-6"><span class="text-muted">โครงการ:</span><br><strong>${r.project||'-'}</strong></div>
                <div class="col-6"><span class="text-muted">สถานที่:</span><br>${r.location||'-'}</div>
                <div class="col-6"><span class="text-muted">ผู้แจ้ง:</span><br>${r.reporterName||'-'}</div>
                <div class="col-6"><span class="text-muted">วันที่แจ้ง:</span><br>${fmtDate(r.createdAt)}</div>
                <div class="col-6"><span class="text-muted">ช่างรับผิดชอบ:</span><br>
                  ${r.assignedToName ? `<span class="text-primary">${r.assignedToName}</span>` : '<span class="text-muted">ยังไม่มอบหมาย</span>'}
                </div>
                ${r.completedAt ? `<div class="col-6"><span class="text-muted">เสร็จสิ้น:</span><br><span class="text-success">${fmtDate(r.completedAt)}</span></div>` : ''}
              </div>
              <hr class="my-2">
              <div class="small"><span class="text-muted">อาการ/ปัญหา:</span><br><p class="mb-0">${r.symptoms||'-'}</p></div>
              ${r.note ? `<div class="small mt-2"><span class="text-muted">หมายเหตุ:</span><br>${r.note}</div>` : ''}
            </div>
          </div>

          <div class="card mb-3">
            <div class="card-header py-2"><i class="bi bi-images me-1"></i>รูปภาพประกอบ</div>
            <div class="card-body">${imagesHtml}</div>
          </div>

          ${updatePanel}
        </div>

        <div class="col-lg-4">
          <div class="card">
            <div class="card-header py-2"><i class="bi bi-clock-history me-1"></i>ประวัติการดำเนินการ</div>
            <div class="card-body">
              ${renderTimeline(r, logs)}
            </div>
          </div>
        </div>
      </div>`;
  } catch (e) {
    console.error('loadDetail error:', e);
    el.innerHTML = `<div class="alert alert-danger">เกิดข้อผิดพลาด: ${e.message}</div>`;
  }
}

function renderTimeline(repair, logs) {
  const items = [
    {
      text: `แจ้งซ่อมใหม่ โดย ${repair.reporterName || '-'}`,
      ts: repair.createdAt,
      dotClass: 'done'
    },
    ...logs.map(log => ({
      text: log.type === 'status_change'
        ? `เปลี่ยนสถานะ → <strong>${log.toStatus}</strong>${log.note ? ' — ' + log.note : ''}`
        : log.note || '—',
      subtext: log.materials && log.materials.length
        ? 'วัสดุ: ' + log.materials.map(m => `${m.name} ${m.qty} ${m.unit}`).join(', ')
        : '',
      by: log.byName,
      ts: log.timestamp,
      dotClass: log.toStatus === 'เสร็จสิ้น' ? 'done' : log.toStatus === 'รอชิ้นส่วน' ? 'warn' : ''
    }))
  ];

  if (!items.length) return '<p class="text-muted small mb-0">ยังไม่มีการดำเนินการ</p>';

  return `<div class="timeline">${items.map(item => `
    <div class="timeline-item">
      <div class="timeline-dot ${item.dotClass || ''}"></div>
      <div class="timeline-text">${item.text}</div>
      ${item.subtext ? `<div class="small text-muted">${item.subtext}</div>` : ''}
      ${item.by ? `<div class="small text-muted">โดย: ${item.by}</div>` : ''}
      <div class="timeline-time">${fmtDate(item.ts)}</div>
    </div>`).join('')}
  </div>`;
}

function addMaterialRow() {
  const list = document.getElementById('materials-list');
  const idx = list.children.length;
  list.insertAdjacentHTML('beforeend', `
    <div class="material-row" id="mat-row-${idx}">
      <input type="text" class="form-control form-control-sm" placeholder="ชื่อวัสดุ/อะไหล่" style="flex:2">
      <input type="number" class="form-control form-control-sm" placeholder="จำนวน" style="flex:1;min-width:70px">
      <input type="text" class="form-control form-control-sm" placeholder="หน่วย" style="flex:1;min-width:60px">
      <button class="btn btn-sm btn-outline-danger btn-remove" onclick="this.closest('.material-row').remove()">
        <i class="bi bi-x"></i>
      </button>
    </div>`);
}

function getMaterials() {
  return Array.from(document.querySelectorAll('.material-row')).map(row => {
    const inputs = row.querySelectorAll('input');
    return { name: inputs[0].value.trim(), qty: inputs[1].value, unit: inputs[2].value.trim() };
  }).filter(m => m.name);
}

async function submitUpdate(repairId, project, machine, repairNumber) {
  const newStatus = document.getElementById('upd-status').value;
  const note = document.getElementById('upd-note').value.trim();
  const materials = getMaterials();

  try {
    const updateData = {
      status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (newStatus === 'เสร็จสิ้น') {
      updateData.completedAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    await db.collection('repairs').doc(repairId).update(updateData);
    await db.collection('repair_logs').add({
      repairId,
      type: 'status_change',
      toStatus: newStatus,
      note,
      materials,
      byUid: currentUser.uid,
      byName: currentUser.displayName || currentUser.email,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    await notifyLine('status_change', { repairNumber, machine, project, status: newStatus, note });

    showToast('อัปเดตสถานะเรียบร้อยแล้ว', 'success');
    loadDetail(repairId);
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

async function cancelRepair(repairId) {
  if (!confirm('ยืนยันการยกเลิกใบแจ้งซ่อมนี้?')) return;
  try {
    await db.collection('repairs').doc(repairId).update({
      status: 'ยกเลิก',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('repair_logs').add({
      repairId,
      type: 'status_change',
      toStatus: 'ยกเลิก',
      note: 'ยกเลิกโดยผู้ใช้',
      materials: [],
      byUid: currentUser.uid,
      byName: currentUser.displayName || currentUser.email,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('ยกเลิกใบแจ้งซ่อมแล้ว', 'warn');
    loadDetail(repairId);
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

// ===== ASSIGN TECHNICIAN =====
async function openAssignModal(repairId) {
  document.getElementById('assign-repair-id').value = repairId;
  const select = document.getElementById('assign-tech-select');
  select.innerHTML = '<option value="">— ไม่มอบหมาย —</option>';
  try {
    const snap = await db.collection('users').where('role', 'in', ['ช่าง', 'ช่างซ่อม']).get();
    snap.forEach(d => {
      const u = d.data();
      select.insertAdjacentHTML('beforeend',
        `<option value="${d.id}" data-name="${u.displayName||u.email}">${u.displayName || u.email} (${u.role})</option>`);
    });
  } catch (e) { console.error(e); }
  new bootstrap.Modal(document.getElementById('modal-assign')).show();
}

async function confirmAssign() {
  const repairId = document.getElementById('assign-repair-id').value;
  const select = document.getElementById('assign-tech-select');
  const uid = select.value;
  const name = uid ? select.options[select.selectedIndex].dataset.name : null;
  try {
    await db.collection('repairs').doc(repairId).update({
      assignedToUid: uid || null,
      assignedToName: name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (uid) {
      await db.collection('repair_logs').add({
        repairId,
        type: 'comment',
        note: `มอบหมายให้ ${name}`,
        materials: [],
        byUid: currentUser.uid,
        byName: currentUser.displayName || currentUser.email,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    bootstrap.Modal.getInstance(document.getElementById('modal-assign')).hide();
    showToast(uid ? `มอบหมายให้ ${name} แล้ว` : 'ยกเลิกการมอบหมายแล้ว', 'success');
    loadDetail(repairId);
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

// ===== ADMIN =====
async function loadAdmin() {
  if (currentUser.role !== 'admin') { navigate('dashboard'); return; }
  await Promise.all([loadUsers(), loadLineGroups()]);
}

function switchAdminTab(tab, el) {
  document.querySelectorAll('#admin-tabs .nav-link').forEach(a => a.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-content-users').classList.toggle('d-none', tab !== 'users');
  document.getElementById('tab-content-line').classList.toggle('d-none', tab !== 'line');
}

async function loadUsers() {
  const tbody = document.getElementById('users-table-body');
  try {
    const [usersSnap, usernamesSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('usernames').get()
    ]);

    // Build email→username map
    const emailToUsername = {};
    usernamesSnap.forEach(d => { emailToUsername[d.data().email] = d.id; });

    tbody.innerHTML = usersSnap.docs.map(d => {
      const u = { id: d.id, ...d.data() };
      const username = emailToUsername[u.email] || '-';
      const pwd = (u.password || '').replace(/'/g, '&#39;');
      return `<tr>
        <td>${u.displayName || '-'}</td>
        <td><code class="small text-primary">${username}</code></td>
        <td class="text-muted small">${u.email || '-'}</td>
        <td>
          <span class="text-muted small" id="pwd-mask-${u.id}">••••••</span>
          <button class="btn btn-link btn-sm p-0 ms-1" style="font-size:.75rem"
            onclick="togglePwd('${u.id}','${pwd}')">
            <i class="bi bi-eye" id="pwd-icon-${u.id}"></i>
          </button>
        </td>
        <td><span class="badge bg-secondary">${u.role || '-'}</span></td>
        <td>${u.disabled ? '<span class="badge bg-danger">ระงับ</span>' : '<span class="badge bg-success">ปกติ</span>'}</td>
        <td>
          <button class="btn btn-xs btn-sm btn-outline-primary py-0" onclick="editUser('${u.id}')">
            <i class="bi bi-pencil"></i>
          </button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="text-center text-muted">ไม่พบผู้ใช้งาน</td></tr>';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-danger">${e.message}</td></tr>`;
  }
}

function togglePwd(uid, pwd) {
  const span = document.getElementById('pwd-mask-' + uid);
  const icon = document.getElementById('pwd-icon-' + uid);
  const hidden = span.textContent === '••••••';
  span.textContent = hidden ? (pwd || '-') : '••••••';
  icon.className = hidden ? 'bi bi-eye-slash' : 'bi bi-eye';
}

async function editUser(uid) {
  document.getElementById('mu-uid').value = uid;
  document.getElementById('modal-user-title').textContent = 'แก้ไขผู้ใช้';
  document.getElementById('mu-name').value = '';
  document.getElementById('mu-role').value = 'ผู้แจ้ง';
  document.getElementById('mu-password').value = '';
  document.getElementById('mu-username-wrap').classList.add('d-none');
  document.getElementById('mu-email-wrap').classList.add('d-none');
  document.getElementById('mu-pwd-wrap').classList.remove('d-none');
  document.getElementById('mu-line-server-note').classList.add('d-none');
  document.getElementById('mu-disable-wrap').classList.remove('d-none');
  document.getElementById('mu-error').classList.add('d-none');

  try {
    const doc = await db.collection('users').doc(uid).get();
    const data = doc.data() || {};
    document.getElementById('mu-name').value = data.displayName || '';
    document.getElementById('mu-role').value = data.role || 'ผู้แจ้ง';
    document.getElementById('mu-password').value = data.password || '';
    document.getElementById('mu-disabled').checked = !!data.disabled;
  } catch (e) { /* ใช้ค่าว่าง */ }

  new bootstrap.Modal(document.getElementById('modal-user')).show();
}

document.getElementById('modal-user').addEventListener('show.bs.modal', () => {
  if (!document.getElementById('mu-uid').value) {
    document.getElementById('modal-user-title').textContent = 'เพิ่มผู้ใช้งาน';
    document.getElementById('mu-name').value = '';
    document.getElementById('mu-username').value = '';
    document.getElementById('mu-email').value = '';
    document.getElementById('mu-password').value = '';
    document.getElementById('mu-role').value = 'ผู้แจ้ง';
    document.getElementById('mu-username-wrap').classList.remove('d-none');
    document.getElementById('mu-email-wrap').classList.remove('d-none');
    document.getElementById('mu-pwd-wrap').classList.remove('d-none');
    document.getElementById('mu-line-server-note').classList.remove('d-none');
    document.getElementById('mu-disable-wrap').classList.add('d-none');
    document.getElementById('mu-error').classList.add('d-none');
  }
});

document.getElementById('modal-user').addEventListener('hidden.bs.modal', () => {
  document.getElementById('mu-uid').value = '';
});

async function saveUser() {
  const uid = document.getElementById('mu-uid').value;
  const name = document.getElementById('mu-name').value.trim();
  const role = document.getElementById('mu-role').value;
  const errEl = document.getElementById('mu-error');
  errEl.classList.add('d-none');

  if (!name || !role) { errEl.textContent = 'กรุณากรอกข้อมูลให้ครบ'; errEl.classList.remove('d-none'); return; }

  const btn = document.getElementById('btn-save-user');
  btn.disabled = true;

  try {
    if (uid) {
      const newPassword = document.getElementById('mu-password').value;
      const updateData = { displayName: name, role, disabled: document.getElementById('mu-disabled').checked };

      if (newPassword) {
        if (newPassword.length < 6) {
          errEl.textContent = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
          errEl.classList.remove('d-none');
          return;
        }
        // เปลี่ยนรหัสผ่านผ่าน secondary app
        const userDoc = await db.collection('users').doc(uid).get();
        const { email, password: oldPwd } = userDoc.data();
        const secondaryApp = firebase.initializeApp(firebase.app().options, 'secondary-' + Date.now());
        try {
          const sec = secondaryApp.auth();
          await sec.signInWithEmailAndPassword(email, oldPwd);
          await sec.currentUser.updatePassword(newPassword);
          await sec.signOut();
        } finally {
          await secondaryApp.delete();
        }
        updateData.password = newPassword;
      }

      await db.collection('users').doc(uid).update(updateData);
      bootstrap.Modal.getInstance(document.getElementById('modal-user')).hide();
      showToast('อัปเดตผู้ใช้เรียบร้อยแล้ว', 'success');
      loadUsers();
    } else {
      const username = document.getElementById('mu-username').value.trim().toLowerCase();
      const email = document.getElementById('mu-email').value.trim();
      const password = document.getElementById('mu-password').value;
      if (!username || !email || !password) {
        errEl.textContent = 'กรุณากรอก username, อีเมล และรหัสผ่าน';
        errEl.classList.remove('d-none');
        return;
      }
      if (!/^[a-z0-9_]+$/.test(username)) {
        errEl.textContent = 'username ใช้ได้เฉพาะ a-z, 0-9, _ เท่านั้น';
        errEl.classList.remove('d-none');
        return;
      }

      // ตรวจ username ซ้ำ
      const existingSnap = await db.collection('usernames').doc(username).get();
      if (existingSnap.exists) {
        errEl.textContent = 'username นี้มีอยู่ในระบบแล้ว';
        errEl.classList.remove('d-none');
        return;
      }

      // สร้าง Firebase Auth user ผ่าน secondary app เพื่อไม่ให้ logout admin
      const secondaryApp = firebase.initializeApp(firebase.app().options, 'secondary-' + Date.now());
      try {
        const secondaryAuth = secondaryApp.auth();
        const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
        const newUid = cred.user.uid;
        await secondaryAuth.signOut();

        const batch = db.batch();
        batch.set(db.collection('users').doc(newUid), {
          email,
          displayName: name,
          role,
          disabled: false,
          password,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        batch.set(db.collection('usernames').doc(username), { email, uid: newUid });
        await batch.commit();
      } finally {
        await secondaryApp.delete();
      }

      bootstrap.Modal.getInstance(document.getElementById('modal-user')).hide();
      showToast(`สร้างผู้ใช้ ${name} (${username}) เรียบร้อยแล้ว`, 'success');
      loadUsers();
    }
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
  }
}

// ===== LINE GROUPS =====
async function loadLineGroups() {
  const tbody = document.getElementById('line-table-body');
  try {
    const snap = await db.collection('line_groups').get();
    tbody.innerHTML = snap.docs.map(d => {
      const g = { id: d.id, ...d.data() };
      return `<tr>
        <td>${g.label || '-'}</td>
        <td>${g.project || '-'}</td>
        <td><code class="small">${g.groupId || '-'}</code></td>
        <td>${g.active ? '<span class="badge bg-success">เปิด</span>' : '<span class="badge bg-secondary">ปิด</span>'}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary py-0" onclick="editLineGroup('${g.id}','${g.label}','${g.project}','${g.groupId}',${!!g.active})">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger py-0 ms-1" onclick="deleteLineGroup('${g.id}')">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="text-center text-muted">ยังไม่มีกลุ่ม LINE</td></tr>';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${e.message}</td></tr>`;
  }
}

function editLineGroup(id, label, project, groupId, active) {
  document.getElementById('ml-doc-id').value = id;
  document.getElementById('ml-label').value = label;
  document.getElementById('ml-project').value = project;
  document.getElementById('ml-group-id').value = groupId;
  document.getElementById('ml-active').checked = active;
  new bootstrap.Modal(document.getElementById('modal-line')).show();
}

document.getElementById('modal-line').addEventListener('hidden.bs.modal', () => {
  document.getElementById('ml-doc-id').value = '';
  document.getElementById('ml-label').value = '';
  document.getElementById('ml-project').value = '';
  document.getElementById('ml-group-id').value = '';
  document.getElementById('ml-active').checked = true;
});

async function saveLineGroup() {
  const docId = document.getElementById('ml-doc-id').value;
  const label = document.getElementById('ml-label').value.trim();
  const project = document.getElementById('ml-project').value;
  const groupId = document.getElementById('ml-group-id').value.trim();
  const active = document.getElementById('ml-active').checked;

  if (!label || !project || !groupId) { showToast('กรุณากรอกข้อมูลให้ครบ', 'error'); return; }

  try {
    const data = { label, project, groupId, active };
    if (docId) {
      await db.collection('line_groups').doc(docId).update(data);
    } else {
      await db.collection('line_groups').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
    bootstrap.Modal.getInstance(document.getElementById('modal-line')).hide();
    showToast('บันทึกกลุ่ม LINE เรียบร้อยแล้ว', 'success');
    loadLineGroups();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

async function deleteLineGroup(docId) {
  if (!confirm('ลบกลุ่ม LINE นี้?')) return;
  try {
    await db.collection('line_groups').doc(docId).delete();
    showToast('ลบกลุ่มแล้ว', 'warn');
    loadLineGroups();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

// ===== REPORTS =====
function initReports() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  document.getElementById('rpt-from').value = new Date(y, m, 1).toISOString().split('T')[0];
  document.getElementById('rpt-to').value = new Date(y, m + 1, 0).toISOString().split('T')[0];
  loadReports();
}

async function loadReports() {
  const from = new Date(document.getElementById('rpt-from').value);
  const to = new Date(document.getElementById('rpt-to').value);
  to.setHours(23, 59, 59);
  const project = document.getElementById('rpt-project').value;

  try {
    let q = db.collection('repairs')
      .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(from))
      .where('createdAt', '<=', firebase.firestore.Timestamp.fromDate(to));
    const snap = await q.get();
    let repairs = snap.docs.map(d => d.data());
    if (project) repairs = repairs.filter(r => r.project === project);

    const total = repairs.length;
    const done = repairs.filter(r => r.status === 'เสร็จสิ้น').length;
    const pending = repairs.filter(r => ['รอดำเนินการ', 'กำลังตรวจสอบ', 'กำลังซ่อม', 'รอชิ้นส่วน'].includes(r.status)).length;
    const critical = repairs.filter(r => r.urgency === 'ด่วนมาก').length;

    document.getElementById('rpt-stats').innerHTML = [
      ['ทั้งหมด', total, '#3b82f6'],
      ['เสร็จสิ้น', done, '#10b981'],
      ['ค้างดำเนินการ', pending, '#f59e0b'],
      ['ด่วนมาก', critical, '#ef4444']
    ].map(([label, val, color]) => `
      <div class="col-6 col-md-3">
        <div class="card p-3 text-center">
          <div style="font-size:2rem;font-weight:700;color:${color}">${val}</div>
          <div class="text-muted small">${label}</div>
        </div>
      </div>`).join('');

    const statusCounts = {};
    STATUSES.forEach(s => statusCounts[s] = repairs.filter(r => r.status === s).length);
    const projCounts = {};
    PROJECTS.forEach(p => projCounts[p] = repairs.filter(r => r.project === p).length);

    renderCharts(statusCounts, projCounts);

    document.getElementById('rpt-table-body').innerHTML = repairs.length
      ? repairs.map(r => `<tr>
          <td><code class="small text-primary">${r.repairNumber||'-'}</code></td>
          <td>${r.machine||'-'}</td>
          <td>${r.project||'-'}</td>
          <td>${urgencyBadge(r.urgency)}</td>
          <td>${statusBadge(r.status)}</td>
          <td class="small">${r.reporterName||'-'}</td>
          <td class="small">${fmtDateShort(r.createdAt)}</td>
          <td class="small">${r.completedAt ? fmtDateShort(r.completedAt) : '-'}</td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="text-center text-muted py-3">ไม่พบข้อมูลในช่วงเวลานี้</td></tr>';

    window._reportData = repairs;
  } catch (e) {
    showToast('โหลดรายงานไม่สำเร็จ: ' + e.message, 'error');
  }
}

function renderCharts(statusCounts, projCounts) {
  const statusColors = ['#f59e0b','#3b82f6','#0ea5e9','#f97316','#10b981','#9ca3af'];
  const projColors = ['#6366f1','#ec4899','#14b8a6'];

  if (chartStatus) chartStatus.destroy();
  if (chartProject) chartProject.destroy();

  chartStatus = new Chart(document.getElementById('chart-status'), {
    type: 'doughnut',
    data: {
      labels: STATUSES,
      datasets: [{ data: STATUSES.map(s => statusCounts[s] || 0), backgroundColor: statusColors, borderWidth: 2 }]
    },
    options: { plugins: { legend: { position: 'bottom', labels: { font: { family: 'Sarabun' } } } } }
  });

  chartProject = new Chart(document.getElementById('chart-project'), {
    type: 'bar',
    data: {
      labels: PROJECTS,
      datasets: [{ label: 'จำนวนงานซ่อม', data: PROJECTS.map(p => projCounts[p] || 0), backgroundColor: projColors, borderRadius: 6 }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

// ===== EXPORT EXCEL (SheetJS) =====
function exportExcel() {
  const repairs = window._reportData || allRepairs;
  if (!repairs.length) { showToast('ไม่มีข้อมูลสำหรับ Export', 'warn'); return; }

  const rows = repairs.map(r => {
    const dt = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null;
    const dtDone = r.completedAt ? (r.completedAt.toDate ? r.completedAt.toDate() : new Date(r.completedAt)) : null;
    return {
      'เลขที่ใบแจ้งซ่อม': r.repairNumber || '',
      'เครื่องจักร': r.machine || '',
      'โครงการ': r.project || '',
      'สถานที่/Zone': r.location || '',
      'อาการ/ปัญหา': r.symptoms || '',
      'ระดับความเร่งด่วน': r.urgency || '',
      'สถานะ': r.status || '',
      'ผู้แจ้ง': r.reporterName || '',
      'ช่างรับผิดชอบ': r.assignedToName || '',
      'วันที่แจ้ง': dt ? dt.toLocaleDateString('th-TH') : '',
      'วันที่เสร็จสิ้น': dtDone ? dtDone.toLocaleDateString('th-TH') : '',
      'หมายเหตุ': r.note || ''
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // Set column widths
  const colWidths = [18, 25, 14, 16, 40, 16, 14, 16, 18, 14, 16, 20];
  ws['!cols'] = colWidths.map(w => ({ wch: w }));

  // Style header row (bold) — SheetJS community edition supports cell refs
  const headerKeys = Object.keys(rows[0]);
  headerKeys.forEach((key, i) => {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
    if (ws[cellRef]) {
      ws[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: 'DBEAFE' } } };
    }
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'งานซ่อม');

  const dateStr = new Date().toLocaleDateString('th-TH').replace(/\//g, '-');
  XLSX.writeFile(wb, `repair-report-${dateStr}.xlsx`);
  showToast('Export Excel เรียบร้อยแล้ว', 'success');
}
