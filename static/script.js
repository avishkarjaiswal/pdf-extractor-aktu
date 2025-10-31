(function() {
  // Multiple result tables are supported; bind to all with class 'result-table'
  const generalTable = document.getElementById('general-table');
  const copyBtn = document.getElementById('copyBtn');
  const status = document.getElementById('copyStatus');
  const toggleRecBtn = document.getElementById('toggleRec');
  const implementBtn = document.getElementById('implementRec');
  const browseBtn = document.getElementById('browseBtn');
  const filePicker = document.getElementById('filePicker');
  const pdfList = document.getElementById('pdfList');
  const removeAllBtn = document.getElementById('removeAllBtn');
  const uploadForm = document.querySelector('form.upload-form');
  const outputWrap = document.querySelector('.output');

  let selectionCounter = 0;
  let isRecording = false;
  let recorded = []; // array of { tableId, row, col }
  let recordedOrder = []; // array of "tableId|row-col" strings

  function makeId(ref) {
    return ref.tableId + '|' + ref.row + '-' + ref.col;
  }

  function getCellPosition(cell) {
    // Use data attributes if present, otherwise compute indices
    const rowAttr = cell.getAttribute('data-row');
    const colAttr = cell.getAttribute('data-col');
    if (rowAttr !== null && colAttr !== null) return { row: Number(rowAttr), col: Number(colAttr) };
    const tr = cell.parentElement;
    const tbody = tr && tr.parentElement;
    const row = tbody ? Array.from(tbody.children).indexOf(tr) : -1;
    const col = tr ? Array.from(tr.children).indexOf(cell) : -1;
    return { row, col };
  }

  function headerForCell(cell) {
    const tableEl = cell.closest('table');
    const { col } = getCellPosition(cell);
    if (!tableEl) return '';
    const ths = tableEl.querySelectorAll('thead th');
    if (ths && ths[col]) return ths[col].textContent || '';
    // Fallback for 2-col general table: use left label text
    const tr = cell.parentElement;
    if (tr && tr.children[0]) return tr.children[0].textContent || '';
    return '';
  }

  function removeOrderBadges(scope=document) {
    scope.querySelectorAll('.order-badge').forEach(el => el.remove());
  }

  function setOrderBadge(cell, num) {
    // Remove existing badge first
    const existing = cell.querySelector('.order-badge');
    if (existing) existing.remove();
    const b = document.createElement('span');
    b.className = 'order-badge';
    b.textContent = String(num);
    cell.appendChild(b);
  }

  function updateRecordingLabel() {
    const lbl = document.getElementById('recordingLabel');
    if (!lbl) return;
    if (!isRecording && recordedOrder.length === 0) {
      lbl.textContent = 'Recording: idle';
      return;
    }
    if (isRecording) {
      if (recordedOrder.length === 0) {
        lbl.textContent = 'Recording Order: none';
        return;
      }
      const parts = recorded.map((ref, i) => {
        const scope = document.getElementById(ref.tableId);
        if (!scope) return 'Cell(' + (i+1) + ')';
        const td = scope.querySelector('td[data-row="' + ref.row + '"][data-col="' + ref.col + '"]') || null;
        const header = td ? headerForCell(td) : '';
        return (header || 'Cell') + '(' + (i+1) + ')';
      });
      lbl.textContent = 'Recording Order: ' + parts.join(' \u2192 ');
    } else {
      lbl.textContent = 'Recording saved with ' + recordedOrder.length + ' cells';
    }
  }

  function saveRecording() {
    try {
      localStorage.setItem('recordedOrder', JSON.stringify(recordedOrder));
    } catch (_) {}
  }

  function loadRecording() {
    try {
      const raw = localStorage.getItem('recordedOrder');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        recordedOrder = parsed.filter(v => typeof v === 'string');
        if (recordingLabel && recordedOrder.length > 0) {
          recordingLabel.textContent = 'Recording saved with ' + recordedOrder.length + ' cells';
        }
      }
    } catch (_) {}
  }

  function keyForCell(cell) {
    const tableEl = cell.closest('table');
    const tableId = tableEl ? tableEl.id : '';
    return {
      tableId,
      row: Number(cell.dataset.row ?? -1),
      col: Number(cell.dataset.col ?? -1),
    };
  }

  function updateRecordLabels() {
    // Update any current recording toggle button text
    const btn = document.getElementById('toggleRec');
    if (btn) btn.textContent = isRecording ? 'Stop Recording' : 'Start Recording';
  }


  function clearSelection() {
    const selected = document.querySelectorAll('td.selected');
    selected.forEach(td => {
      td.classList.remove('selected');
      delete td.dataset.sel;
    });
    removeOrderBadges();
    selectionCounter = 0;
    updateSelectionOrderDisplay();
  }

  function updateSelectionOrderDisplay() {
    const el = document.getElementById('selectionOrder');
    if (!el) return;
    const selected = Array.from(document.querySelectorAll('td.selected'))
      .filter(td => td.dataset.sel)
      .sort((a,b) => Number(a.dataset.sel) - Number(b.dataset.sel));
    if (selected.length === 0) {
      el.textContent = 'Selection Order: none';
      return;
    }
    const order = selected.map(td => td.dataset.sel);
    el.textContent = 'Selection Order: ' + order.join(', ');
  }

  function toggleCellSelection(cell, additive) {
    if (!additive) {
      clearSelection();
    }

    if (cell.classList.contains('selected')) {
      // Remove and renumber subsequent selections to keep order contiguous
      const removedIndex = Number(cell.dataset.sel);
      cell.classList.remove('selected');
      delete cell.dataset.sel;

      const others = Array.from(document.querySelectorAll('td.selected'))
        .filter(td => td.dataset.sel && Number(td.dataset.sel) > removedIndex)
        .sort((a,b) => Number(a.dataset.sel) - Number(b.dataset.sel));
      for (const td of others) {
        td.dataset.sel = String(Number(td.dataset.sel) - 1);
      }
      selectionCounter = Math.max(0, selectionCounter - 1);
    } else {
      selectionCounter += 1;
      cell.classList.add('selected');
      cell.dataset.sel = String(selectionCounter);
    }

    updateSelectionOrderDisplay();

    // Recording behavior
    if (isRecording) {
      // push or remove from recorded arrays and update badges + label
      const pos = getCellPosition(cell);
      const tableEl = cell.closest('table');
      const ref = { tableId: tableEl ? tableEl.id : '', row: pos.row, col: pos.col };
      const id = makeId(ref);
      const idx = recorded.findIndex(r => r.tableId === ref.tableId && r.row === ref.row && r.col === ref.col);
      if (cell.classList.contains('selected')) {
        if (idx === -1) {
          recorded.push(ref);
          recordedOrder.push(id);
        }
      } else {
        if (idx !== -1) {
          recorded.splice(idx, 1);
          const oid = recordedOrder.indexOf(id);
          if (oid !== -1) recordedOrder.splice(oid, 1);
          // Renumber badges for remaining recorded cells
          document.querySelectorAll('td.selected').forEach(td => {
            const p = getCellPosition(td);
            const tid = makeId({ tableId: td.closest('table') ? td.closest('table').id : '', row: p.row, col: p.col });
            const newIndex = recordedOrder.indexOf(tid);
            if (newIndex !== -1) setOrderBadge(td, newIndex + 1);
          });
        }
      }
      // Set badge for this cell to its order
      if (cell.classList.contains('selected')) {
        setOrderBadge(cell, recordedOrder.length);
      } else {
        const badge = cell.querySelector('.order-badge');
        if (badge) badge.remove();
      }
      updateRecordLabels();
      updateRecordingLabel();
    }
  }

  function bindTableSelection(tableEl) {
    if (!tableEl) return;
    tableEl.addEventListener('click', function(e) {
      const cell = e.target.closest('td');
      if (!cell || !tableEl.contains(cell)) return;
      // Allow multi-select if Ctrl/Meta, Shift, or while recording
      const additive = (e.ctrlKey || e.metaKey || e.shiftKey || isRecording);
      toggleCellSelection(cell, additive);
    });
  }

  // Bind selection for all currently present result tables
  document.querySelectorAll('table.result-table').forEach(tbl => bindTableSelection(tbl));
  bindTableSelection(generalTable);

  async function copySelected() {
    const selected = Array.from(document.querySelectorAll('td.selected'));
    if (selected.length === 0) {
      if (status) status.textContent = 'No cells selected';
      return;
    }

    // Preserve exact click order (dataset.sel) and output as a single tab-separated line
    const ordered = selected
      .filter(td => td.dataset.sel)
      .sort((a,b) => Number(a.dataset.sel) - Number(b.dataset.sel))
      .map(td => {
        // Exclude the order badge text from copied content
        const clone = td.cloneNode(true);
        const badges = clone.querySelectorAll('.order-badge');
        badges.forEach(b => b.remove());
        return (clone.textContent || '').trim();
      });
    const text = ordered.join('\t');

    try {
      await navigator.clipboard.writeText(text);
      if (status) {
        status.textContent = 'Copied';
        setTimeout(() => status.textContent = '', 1600);
      }
    } catch (err) {
      if (status) status.textContent = 'Failed to copy';
    }
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', copySelected);
  }

  // Recording controls
  function handleToggleRecording() {
    if (isRecording) {
      // Stop recording
      isRecording = false;
      updateRecordLabels();
      // Persist recordedOrder from recorded
      recordedOrder = recorded.map(r => makeId(r));
      saveRecording();
      updateRecordingLabel();
    } else {
      // Start recording
      isRecording = true;
      recorded = [];
      recordedOrder = [];
      clearSelection();
      updateRecordLabels();
      updateRecordingLabel();
    }
  }

  if (toggleRecBtn) {
    toggleRecBtn.addEventListener('click', handleToggleRecording);
  }

  // ------------------------
  // Sidebar: Browse & Upload (client-side only)
  // ------------------------
  const clientFiles = new Map(); // name -> File

  // ------------------------
  // Loader helpers
  // ------------------------
  function showLoader(text = 'Extracting data...') {
    let overlay = document.getElementById('loaderOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loaderOverlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.background = 'rgba(0,0,0,0.4)';
      overlay.style.zIndex = '2000';
      const box = document.createElement('div');
      box.style.background = 'rgba(31,41,55,0.95)';
      box.style.color = '#fff';
      box.style.padding = '12px 16px';
      box.style.border = '1px solid rgba(255,255,255,0.2)';
      box.style.borderRadius = '10px';
      box.style.fontSize = '14px';
      box.id = 'loaderText';
      box.textContent = text;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    } else {
      const box = document.getElementById('loaderText');
      if (box) box.textContent = text;
      overlay.style.display = 'flex';
    }
  }

  function hideLoader() {
    const overlay = document.getElementById('loaderOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function renderClientList() {
    if (!pdfList) return;
    pdfList.innerHTML = '';
    for (const [name, file] of clientFiles.entries()) {
      const row = document.createElement('div');
      row.className = 'list-group-item pdf-item d-flex align-items-center gap-2';

      const bullet = document.createElement('span');
      bullet.className = 'badge rounded-pill text-bg-secondary';
      bullet.textContent = '#';

      const link = document.createElement('a');
      link.href = '#';
      link.className = 'text-decoration-none flex-grow-1 text-truncate small pdf-name';
      link.style.maxWidth = '100%';
      link.title = name;
      link.textContent = name;
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        await loadAndRenderLocalFile(file);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-sm btn-outline-white ms-auto';
      delBtn.textContent = 'Remove';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        clientFiles.delete(name);
        renderClientList();
      });

      row.appendChild(bullet);
      row.appendChild(link);
      row.appendChild(delBtn);
      pdfList.appendChild(row);
    }
  }

  async function uploadSelectedFiles(files) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach(f => clientFiles.set(f.name, f));
    renderClientList();
  }

  if (browseBtn && filePicker) {
    browseBtn.addEventListener('click', () => filePicker.click());
    filePicker.addEventListener('change', () => {
      uploadSelectedFiles(filePicker.files);
      // do not reset immediately; allow reselecting same files later
    });
  }

  if (removeAllBtn) {
    removeAllBtn.addEventListener('click', async () => {
      clientFiles.clear();
      renderClientList();
    });
  }

  // ------------------------
  // Load & Render a PDF
  // ------------------------
  function ensureTablesContainer() {
    if (document.getElementById('tablesContainer')) return;
    if (!outputWrap) return;
    // If skeleton not present (e.g., initial GET), create minimal structure similar to template
    const actions = document.createElement('div');
    actions.className = 'actions d-flex align-items-center gap-2';
    actions.innerHTML = '' +
      '<button id="toggleRec" type="button" class="btn btn-outline-primary btn-sm" style="color: white;">Start Recording</button>' +
      '<button id="implementRec" type="button" class="btn btn-outline-secondary btn-sm" style="color: white;">Implement Recording</button>' +
      '<button id="copyBtn" type="button" class="btn btn-outline-success btn-sm" style="color: white;">Copy Selected</button>' +
      '<span id="copyStatus" class="muted"></span>';
    const order = document.createElement('div');
    order.id = 'selectionOrder';
    order.className = 'muted small mt-1';
    order.textContent = 'Selection Order: none';
    const recLbl = document.createElement('div');
    recLbl.id = 'recordingLabel';
    recLbl.className = 'muted small';
    recLbl.textContent = 'Recording: idle';
    const container = document.createElement('div');
    container.id = 'tablesContainer';
    outputWrap.innerHTML = '';
    outputWrap.appendChild(actions);
    outputWrap.appendChild(order);
    outputWrap.appendChild(recLbl);
    outputWrap.appendChild(container);
    // Rebind local button references and listeners
    const newCopyBtn = document.getElementById('copyBtn');
    if (newCopyBtn) newCopyBtn.addEventListener('click', copySelected);
    const newToggle = document.getElementById('toggleRec');
    if (newToggle) newToggle.addEventListener('click', handleToggleRecording);
    const newImpl = document.getElementById('implementRec');
    if (newImpl) newImpl.addEventListener('click', handleImplementRecording);
  }
  function renderGeneralInfo(generalInfo) {
    const allowed = new Set(['RollNo','EnrollmentNo','Name','Gender']);
    const filtered = (generalInfo || []).filter(pair => allowed.has(pair[0]));

    // Find or create the General Information card above .output
    let card = document.getElementById('general-card');
    if (!filtered.length) {
      // Remove card if exists and there is no data
      if (card && card.parentElement) card.parentElement.removeChild(card);
      return;
    }

    if (!card) {
      card = document.createElement('div');
      card.id = 'general-card';
      card.className = 'card mb-3';
      const header = document.createElement('div');
      header.className = 'card-header';
      header.textContent = 'General Information';
      const body = document.createElement('div');
      body.className = 'card-body p-0';
      const table = document.createElement('table');
      table.id = 'general-table';
      table.className = 'table table-sm mb-0';
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);
      body.appendChild(table);
      card.appendChild(header);
      card.appendChild(body);
      // Insert before .output to match original layout
      if (outputWrap && outputWrap.parentElement) {
        outputWrap.parentElement.insertBefore(card, outputWrap);
      } else {
        document.querySelector('main.col')?.appendChild(card);
      }
    }

    const table = card.querySelector('#general-table');
    const tbody = table ? table.querySelector('tbody') : null;
    if (!tbody) return;
    tbody.innerHTML = '';
    filtered.forEach((pair, idx) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'w-25';
      th.textContent = pair[0];
      const td = document.createElement('td');
      // add position data to support consistent selection/recording
      td.dataset.row = String(idx);
      td.dataset.col = '0';
      td.textContent = pair[1];
      tr.appendChild(th);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });

    // ensure selection binding is active for dynamically created general table
    if (table && !table.dataset.bound) {
      bindTableSelection(table);
      table.dataset.bound = '1';
    }
  }

  function renderTables(blocks) {
    const container = document.getElementById('tablesContainer');
    if (!container) return;
    container.innerHTML = '';
    (blocks || []).forEach((blk, i) => {
      const card = document.createElement('div');
      card.className = 'card mb-3';
      const header = document.createElement('div');
      header.className = 'card-header';
      header.textContent = 'Marksheet Table ' + (i + 1);
      const body = document.createElement('div');
      body.className = 'card-body p-0';
      // Mini summary table above marksheet table (selectable like data table)
      if (blk.summary) {
        const wrapSum = document.createElement('div');
        wrapSum.className = 'table-wrap summary-wrap';
        const sumTbl = document.createElement('table');
        sumTbl.id = 'summary-table-' + (i + 1);
        sumTbl.className = 'result-table table table-sm mb-0';
        const tbodySum = document.createElement('tbody');
        // Row 1
        const r1 = document.createElement('tr');
        const r1c1h = document.createElement('th'); r1c1h.textContent = 'Semester :';
        const r1c1 = document.createElement('td'); r1c1.dataset.row = '0'; r1c1.dataset.col = '0'; r1c1.textContent = (blk.summary['Semester'] || '') + (blk.summary['Even/Odd'] ? ' (' + blk.summary['Even/Odd'] + ')' : '');
        const r1c2h = document.createElement('th'); r1c2h.textContent = 'Total Marks :';
        const r1c2 = document.createElement('td'); r1c2.dataset.row = '0'; r1c2.dataset.col = '1'; r1c2.textContent = blk.summary['Total Marks Obt.'] || '';
        const r1c3h = document.createElement('th'); r1c3h.textContent = 'SGPA :';
        const r1c3 = document.createElement('td'); r1c3.dataset.row = '0'; r1c3.dataset.col = '2'; r1c3.textContent = blk.summary['SGPA'] || '';
        r1.append(r1c1h, r1c1, r1c2h, r1c2, r1c3h, r1c3);
        // Row 2
        const r2 = document.createElement('tr');
        const r2c1h = document.createElement('th'); r2c1h.textContent = 'Result :';
        const r2c1 = document.createElement('td'); r2c1.dataset.row = '1'; r2c1.dataset.col = '0'; r2c1.colSpan = 5; r2c1.textContent = blk.summary['Result Status'] || '';
        r2.append(r2c1h, r2c1);
        tbodySum.append(r1, r2);
        sumTbl.appendChild(tbodySum);
        wrapSum.appendChild(sumTbl);
        body.appendChild(wrapSum);
        // bind selection to the summary table as well
        bindTableSelection(sumTbl);
      }
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      const tbl = document.createElement('table');
      tbl.id = 'result-table-' + (i + 1);
      tbl.className = 'result-table table table-sm table-hover table-bordered align-middle';

      // thead
      if (Array.isArray(blk.header) && blk.header.length > 0) {
        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        blk.header.forEach(h => {
          const th = document.createElement('th');
          th.textContent = h;
          tr.appendChild(th);
        });
        thead.appendChild(tr);
        tbl.appendChild(thead);
      }

      // tbody
      const tbody = document.createElement('tbody');
      (blk.rows || []).forEach((row, r) => {
        const tr = document.createElement('tr');
        row.forEach((val, c) => {
          const td = document.createElement('td');
          td.dataset.row = String(r);
          td.dataset.col = String(c);
          td.textContent = val;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);

      wrap.appendChild(tbl);
      body.appendChild(wrap);
      card.appendChild(header);
      card.appendChild(body);
      container.appendChild(card);

      // bind selection to this table
      bindTableSelection(tbl);
    });
  }

  async function loadAndRenderLocalFile(file) {
    try {
      showLoader();
      const fd = new FormData();
      fd.append('pdf', file);
      const res = await fetch('/api/extract_stream', { method: 'POST', body: fd });
      const data = await res.json();
      if (data && !data.error) {
        ensureTablesContainer();
        clearSelection();
        renderGeneralInfo(data.general_info || []);
        renderTables(data.marksheet_blocks || []);
        const hasData = (Array.isArray(data.marksheet_blocks) && data.marksheet_blocks.length > 0);
        if (!hasData) {
          if (outputWrap) {
            const container = document.getElementById('tablesContainer');
            if (container) container.innerHTML = '<p class="muted">No valid data found in this PDF.</p>';
          }
        }
      }
    } catch (err) {}
    finally { hideLoader(); }
  }

  // initial sidebar list (client-side only)
  renderClientList();

  // Intercept form submit to use fetch without reload
  if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = uploadForm.querySelector('#pdf');
      const countInput = uploadForm.querySelector('#count');
      const file = fileInput && fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        showLoader();
        const fd = new FormData();
        fd.append('pdf', file);
        if (countInput && countInput.value) fd.append('count', countInput.value);
        const res = await fetch('/api/extract_stream', { method: 'POST', body: fd });
        const data = await res.json();
        if (data && !data.error) {
          ensureTablesContainer();
          clearSelection();
          renderGeneralInfo(data.general_info || []);
          renderTables(data.marksheet_blocks || []);
          const hasData = (Array.isArray(data.marksheet_blocks) && data.marksheet_blocks.length > 0);
          if (!hasData) {
            const container = document.getElementById('tablesContainer');
            if (container) container.innerHTML = '<p class="muted">No valid data found in this PDF.</p>';
          }
        } else {
          const container = document.getElementById('tablesContainer');
          if (container) container.innerHTML = '<p class="muted">No valid data found in this PDF.</p>';
        }
      } catch (_) {
        const container = document.getElementById('tablesContainer');
        if (container) container.innerHTML = '<p class="muted">No valid data found in this PDF.</p>';
      } finally {
        hideLoader();
      }
    });
  }
  function handleImplementRecording() {
    if (!recordedOrder || recordedOrder.length === 0) {
      loadRecording();
      if (!recordedOrder || recordedOrder.length === 0) return;
    }
    clearSelection();
    let order = 0;
    recordedOrder.forEach(id => {
      const [tableId, rc] = id.split('|');
      const [rStr, cStr] = rc.split('-');
      const r = Number(rStr), c = Number(cStr);
      const scope = document.getElementById(tableId);
      if (!scope) return;
      const td = scope.querySelector('td[data-row="' + r + '"][data-col="' + c + '"]') || (function(){
        // fallback compute by traversing rows
        const tbody = scope.querySelector('tbody');
        if (!tbody) return null;
        const rowEl = tbody.children[r];
        if (!rowEl) return null;
        return rowEl.children[c] || null;
      })();
      if (td) {
        order += 1;
        td.classList.add('selected');
        td.dataset.sel = String(order);
        setOrderBadge(td, order);
      }
    });
    selectionCounter = order;
    updateSelectionOrderDisplay();
      const lbl = document.getElementById('recordingLabel');
      if (lbl) lbl.textContent = 'Recording applied successfully';
  }

  if (implementBtn) {
    implementBtn.addEventListener('click', handleImplementRecording);
  }

  // Load any saved recording on page load (useful after extracting a new PDF)
  loadRecording();
  updateRecordLabels();
  updateRecordingLabel();
})();


