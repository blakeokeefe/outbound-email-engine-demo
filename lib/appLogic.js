import { supabase } from './supabaseClient';
import { lighten, darken } from './colorUtils';
import { fillTemplate } from './templateUtils';

const STAGES = ['New','Emailed','Replied','Meeting'];
const BADGE = { New:'badge-new', Emailed:'badge-emailed', Replied:'badge-replied', Meeting:'badge-meeting' };
const SOURCE_BADGE = { existing:'badge-existing', discovered:'badge-discovered', imported:'badge-discovered', manual:'badge-discovered' };

// ── Shared in-memory state (hydrated from Supabase via /api/leads) ───────────
let campaigns = [];
let activeCampaign = null;
let leads = [];
let selectedLeads = new Set();

// ── Gmail compose — stored at generation time so the URL is built on click ──
const _emailStore = {};

function openInGmail(id) {
  const d = _emailStore[id];
  if (!d) return;
  const base = 'https://mail.google.com/mail/?view=cm&fs=1'
    + (d.to      ? '&to='   + encodeURIComponent(d.to)      : '')
    + (d.subject ? '&su='   + encodeURIComponent(d.subject)  : '')
    + (d.body    ? '&body=' + encodeURIComponent(d.body)     : '');
  // Gmail truncates compose URLs beyond ~1900 chars. Fall back to clipboard for long bodies.
  if (base.length > 1900 && d.body) {
    const short = 'https://mail.google.com/mail/?view=cm&fs=1'
      + (d.to      ? '&to=' + encodeURIComponent(d.to)     : '')
      + (d.subject ? '&su=' + encodeURIComponent(d.subject) : '');
    navigator.clipboard.writeText(d.body).catch(() => {});
    window.open(short, '_blank');
    toast('Email body copied to clipboard — paste it into Gmail.');
  } else {
    window.open(base, '_blank');
  }
}

// ── Leads API ─────────────────────────────────────────────────────────────────
async function loadLeads() {
  const res = await fetch(`/api/leads?campaign_id=${activeCampaign.id}`);
  if (!res.ok) throw new Error('Failed to load leads');
  return res.json();
}

async function createLead(payload) {
  const res = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create lead');
  return res.json();
}

async function patchLead(id, payload) {
  const res = await fetch(`/api/leads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update lead');
  return res.json();
}

async function deleteLead(id) {
  if (!confirm('Delete this lead? This can\'t be undone.')) return;
  try {
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete lead');
    leads = leads.filter(l => l.id !== id);
    selectedLeads.delete(id);
    updateMetrics();
    renderLeads();
    toast('Lead deleted.');
  } catch (e) {
    toast('Failed to delete lead.');
  }
}

async function deleteSelectedLeads() {
  if (!selectedLeads.size) return;
  if (!confirm(`Delete ${selectedLeads.size} selected lead(s)? This can't be undone.`)) return;
  for (const id of Array.from(selectedLeads)) {
    try { await fetch(`/api/leads/${id}`, { method: 'DELETE' }); } catch (e) {}
  }
  leads = leads.filter(l => !selectedLeads.has(l.id));
  selectedLeads.clear();
  updateMetrics();
  renderLeads();
  toast('Selected leads deleted.');
}

// ── Campaigns ────────────────────────────────────────────────────────────────
async function loadCampaigns() {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data;
}

function setCampaignColors(c) {
  const root = document.documentElement.style;
  root.setProperty('--orange', c.primary_color);
  root.setProperty('--navy', c.secondary_color || c.primary_color);
  root.setProperty('--accent-tint', lighten(c.primary_color, 42));
  root.setProperty('--accent-count-tint', lighten(c.primary_color, 32));
  root.setProperty('--accent-hover', darken(c.primary_color, 10));
  root.setProperty('--primary-hover', darken(c.secondary_color || c.primary_color, 8));
}

function renderTopbarLogo() {
  const container = document.querySelector('.topbar-logo .flag');
  if (!container) return;
  if (activeCampaign.logo_url) {
    container.innerHTML = `<img src="${activeCampaign.logo_url}" alt="${activeCampaign.name}" style="width:100%;height:100%;object-fit:contain;border-radius:4px;">`;
  } else {
    container.innerHTML = `<span style="color:white;font-weight:700;font-size:13px;">${activeCampaign.name.charAt(0).toUpperCase()}</span>`;
  }
}

function renderCampaignSwitcher() {
  const btn = document.getElementById('campaign-switcher-btn');
  if (btn) btn.textContent = activeCampaign.name;
  const menu = document.getElementById('campaign-menu');
  if (!menu) return;
  menu.innerHTML = campaigns.map(c => `
    <button onclick="selectCampaign('${c.slug}')" style="display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:${c.slug === activeCampaign.slug ? '#f9fafb' : 'white'};cursor:pointer;font-size:12px;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.primary_color};margin-right:6px;"></span>${c.name}
    </button>`).join('');
}

function toggleCampaignMenu() {
  const menu = document.getElementById('campaign-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function applyCampaignConfig() {
  document.title = activeCampaign.name + ' — Outbound Email Engine';
  const el = id => document.getElementById(id);
  if (el('topbar-title-text')) el('topbar-title-text').textContent = activeCampaign.name;
  if (el('page-discover-subtitle')) el('page-discover-subtitle').textContent = activeCampaign.config.discover_subtitle;
  if (el('page-compose-subtitle')) el('page-compose-subtitle').textContent = activeCampaign.config.compose_subtitle;
  const sel = el('campaign-type');
  if (sel) sel.innerHTML = activeCampaign.config.campaign_types.map(ct => `<option value="${ct.value}">${ct.label}</option>`).join('');
}

async function selectCampaign(slug) {
  const next = campaigns.find(c => c.slug === slug);
  if (!next) return;
  activeCampaign = next;
  localStorage.setItem('activeCampaignSlug', slug);
  document.getElementById('campaign-menu').style.display = 'none';
  setCampaignColors(next);
  renderTopbarLogo();
  renderCampaignSwitcher();
  applyCampaignConfig();
  renderDiscoverFilters();
  renderKnownCustomers();
  const discoverResults = document.getElementById('discover-results');
  if (discoverResults) discoverResults.innerHTML = '';
  window._discovered = [];
  selectedLeads.clear();
  try {
    leads = await loadLeads();
  } catch (e) {
    leads = [];
    toast('Failed to load leads for this campaign.');
  }
  updateMetrics();
  renderLeads();
  renderPipeline();
}

// ── General helpers ──────────────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  const navItems = document.querySelectorAll('.nav-item');
  const map = { discover:0, leads:1, pipeline:2, review:3 };
  if(map[name] !== undefined) navItems[map[name]].classList.add('active');
  if(name==='leads') renderLeads();
  if(name==='pipeline') renderPipeline();
  if(name==='review') renderReviewQueue();
  updateMetrics();
}

function updateMetrics() {
  const total = leads.length;
  const newC = leads.filter(l=>l.status==='New').length;
  const sent = leads.filter(l=>['Emailed','Replied','Meeting'].includes(l.status)).length;
  const replied = leads.filter(l=>['Replied','Meeting'].includes(l.status)).length;
  const meetings = leads.filter(l=>l.status==='Meeting').length;
  ['total','new','sent','replied'].forEach(k => {
    const el = document.getElementById('m-'+k);
    if(el) el.textContent = k==='replied'?replied:k==='total'?total:k==='new'?newC:sent;
  });
  ['total','sent','replied','meetings'].forEach((k,i) => {
    const el = document.getElementById('hm-'+k);
    if(el) el.textContent = [total,sent,replied,meetings][i];
  });
  const navCount = document.getElementById('nav-leads-count');
  if(navCount) navCount.textContent = total;
}

function renderLeads() {
  const search = (document.getElementById('lead-search')?.value||'').toLowerCase();
  const statusF = document.getElementById('lead-status-filter')?.value||'all';
  const sourceF = document.getElementById('lead-source-filter')?.value||'all';
  const filtered = leads.filter(l => {
    const text = (l.org+l.contact+l.location+l.email).toLowerCase();
    return (!search||text.includes(search)) && (statusF==='all'||l.status===statusF) && (sourceF==='all'||l.source===sourceF);
  });
  const tbody = document.getElementById('leads-tbody');
  if(!filtered.length) { tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">No leads match the current filters.</div></td></tr>'; return; }
  tbody.innerHTML = filtered.map(l => `
    <tr>
      <td><input type="checkbox" class="cb" ${selectedLeads.has(l.id)?'checked':''} onchange="toggleLead(${l.id},this.checked)"></td>
      <td>
        <div style="font-weight:600;font-size:13px;">${l.org}</div>
        ${l.email?`<div style="font-size:11px;color:var(--text-muted);">${l.email}</div>`:''}
      </td>
      <td style="font-size:12px;">${l.contact||'<span style="color:var(--text-hint)">—</span>'}${l.title?`<br><span style="color:var(--text-hint);font-size:11px;">${l.title}</span>`:''}</td>
      <td style="font-size:12px;">${l.location}</td>
      <td style="font-size:12px;">${l.type}</td>
      <td><span class="badge ${SOURCE_BADGE[l.source]||'badge-discovered'}">${l.source}</span></td>
      <td><span class="badge ${BADGE[l.status]||'badge-new'}">${l.status}</span></td>
      <td>
        <select style="font-size:11px;padding:4px 8px;width:100%;" onchange="updateStatus(${l.id},this.value)">
          ${STAGES.map(s=>`<option ${l.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <button class="btn btn-xs" onclick="deleteLead(${l.id})" title="Delete lead" style="margin-left:4px;">✕</button>
      </td>
    </tr>`).join('');
  updateMetrics();
}

function filterLeads() { renderLeads(); }
function toggleLead(id,checked) { if(checked) selectedLeads.add(id); else selectedLeads.delete(id); }
function toggleSelectAll(checked) { leads.forEach(l => checked ? selectedLeads.add(l.id) : selectedLeads.delete(l.id)); renderLeads(); }

async function updateStatus(id, status) {
  const l = leads.find(x=>x.id===id);
  if(l) l.status = status;
  updateMetrics();
  renderPipeline();
  try {
    await patchLead(id, { status });
  } catch(e) {
    toast('Failed to update status.');
  }
}

function openAddLead() {
  const f = document.getElementById('add-lead-form');
  f.style.display = f.style.display==='none'||!f.style.display ? 'block' : 'none';
}

async function submitAddLead() {
  const org = document.getElementById('nl-org').value.trim();
  if(!org) { alert('Organization is required.'); return; }
  const payload = {
    org,
    contact: document.getElementById('nl-contact').value.trim(),
    email: document.getElementById('nl-email').value.trim(),
    title: document.getElementById('nl-title').value.trim(),
    location: document.getElementById('nl-location').value.trim(),
    type: document.getElementById('nl-type').value,
    status: 'New',
    source: 'manual',
    campaign_id: activeCampaign.id,
  };
  try {
    const created = await createLead(payload);
    leads.push(created);
    ['nl-org','nl-contact','nl-email','nl-title','nl-location'].forEach(id => document.getElementById(id).value='');
    document.getElementById('add-lead-form').style.display='none';
    renderLeads();
    toast('Lead added.');
  } catch(e) {
    toast('Failed to add lead.');
  }
}

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function importCSV(input) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const lines = e.target.result.split('\n').slice(1);
    const rows = lines.map(line => parseCsvLine(line)).filter(c=>c[0]);
    let added = 0;
    for(const c of rows) {
      try {
        const created = await createLead({org:c[0],contact:c[1]||'',email:c[2]||'',title:c[3]||'',location:c[4]||'',type:c[5]||'School District',status:'New',source:c[6]||'imported',campaign_id:activeCampaign.id});
        leads.push(created);
        added++;
      } catch(err) {}
    }
    renderLeads();
    toast(`${added} leads imported from CSV.`);
  };
  reader.readAsText(file);
}

async function importExistingCustomers() {
  const existing = activeCampaign.config.known_customers || [];
  let added = 0;
  for (const e of existing) {
    if (!leads.find(l => l.org === e.org)) {
      try {
        const created = await createLead({ ...e, status: 'New', source: 'existing', campaign_id: activeCampaign.id });
        leads.push(created);
        added++;
      } catch (err) {}
    }
  }
  toast(added ? `${added} existing customers added as leads.` : 'Already imported.');
  updateMetrics();
  renderLeads();
}

function bulkCompose() { showPanel('review'); }

async function bulkMarkEmailed() {
  const ids = Array.from(selectedLeads);
  const sentAt = new Date().toISOString();
  for(const id of ids) {
    const l = leads.find(x=>x.id===id);
    if(l) { l.status = 'Emailed'; l.sent_at = sentAt; }
    try { await patchLead(id, { status: 'Emailed', sent_at: sentAt }); } catch(e) { console.error('Failed to update lead:', e); }
  }
  selectedLeads.clear();
  renderLeads();
  toast('Marked as Emailed.');
}

// ── Compose ──────────────────────────────────────────────────────────────────
function renderComposeList() {
  const list = document.getElementById('compose-lead-list');
  const composable = leads.filter(l => ['New','Emailed'].includes(l.status));
  if(!composable.length) { list.innerHTML='<div style="font-size:12px;color:var(--text-muted);">No new or emailed leads. Add leads first.</div>'; return; }
  list.innerHTML = composable.map(l => `
    <div class="compose-lead-item ${selectedLeads.has(l.id)?'selected':''}" onclick="toggleComposeLead(${l.id},this)">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;">${l.org}</span>
      <div class="compose-check">${selectedLeads.has(l.id)?'✓':''}</div>
    </div>`).join('');
}

function toggleComposeLead(id, el) {
  if(selectedLeads.has(id)) { selectedLeads.delete(id); el.classList.remove('selected'); el.querySelector('.compose-check').textContent=''; }
  else { selectedLeads.add(id); el.classList.add('selected'); el.querySelector('.compose-check').textContent='✓'; }
}

function selectAllCompose() {
  leads.filter(l=>l.status==='New').forEach(l => selectedLeads.add(l.id));
  renderComposeList();
}

async function generateEmails() {
  const selected = leads.filter(l => selectedLeads.has(l.id));
  if(!selected.length) { alert('Select at least one lead first.'); return; }
  const campaign = document.getElementById('campaign-type').value;
  const tone = document.getElementById('email-tone').value;
  const extra = document.getElementById('extra-context').value.trim();
  const output = document.getElementById('email-output');

  const campaignLabel = activeCampaign.config.campaign_labels[campaign] || campaign;
  output.innerHTML = `<div class="loading"><div class="spinner"></div>Generating ${selected.length} personalized email${selected.length>1?'s':''}…</div>`;

  const btn = document.getElementById('gen-btn');
  btn.disabled = true;

  for(let i=0; i<selected.length; i++) {
    const l = selected[i];
    const leadTitle = l.title || l.contact || activeCampaign.config.default_contact_role;
    const extraLine = extra ? 'Additional context: ' + extra : '';
    const prompt = fillTemplate(activeCampaign.config.email_prompt_template, {
      tone, campaign_label: campaignLabel,
      lead_org: l.org, lead_title: leadTitle, lead_location: l.location, lead_type: l.type,
      extra_context_line: extraLine,
      greeting: 'Hi,',
    });

    try {
      const resp = await fetch('/api/generate-email', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ prompt }),
      });
      const data = await resp.json();
      if(!resp.ok) throw new Error(data.error || 'Request failed');
      const text = data.text || '';
      const lines = text.split('\n');
      const subjectIdx = lines.findIndex(ln => ln.toLowerCase().startsWith('subject:'));
      const subject = subjectIdx>=0 ? lines[subjectIdx].replace(/^subject:\s*/i,'').trim() : '—';
      const body = lines.filter((_,ii)=>ii!==subjectIdx).join('\n').trim();
      const signature = activeCampaign.sender_name
        ? `\n\n${activeCampaign.sender_name}${activeCampaign.sender_title ? ' | ' + activeCampaign.sender_title : ''}${activeCampaign.sender_email ? ' | ' + activeCampaign.sender_email : ''}`
        : '';
      const finalBody = body + signature;

      // Store for reliable Gmail open (built at click time, not baked into HTML)
      _emailStore[l.id] = { to: l.email, subject, body: finalBody };

      if(i===0) output.innerHTML='';

      const card = document.createElement('div');
      card.className = 'email-card';
      card.innerHTML = `
        <div class="email-card-header">
          <div>
            <div style="font-weight:600;font-size:14px;">${l.org}</div>
            <div class="email-subject">Subject</div>
            <div class="email-subject-val">${subject}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="badge ${BADGE[l.status]||'badge-new'}">${l.status}</span>
            <button class="btn btn-sm" onclick="copyEmail(this,'${encodeURIComponent(finalBody)}')">Copy</button>
            ${l.email
              ? `<button class="btn btn-sm btn-orange" onclick="openInGmail(${l.id})">Open in Gmail →</button>`
              : '<span style="font-size:11px;color:var(--text-hint);">No email on record</span>'}
          </div>
        </div>
        <div class="email-card-body">
          <div class="email-body-text">${finalBody.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          <div class="email-actions">
            <button class="btn btn-sm btn-primary" onclick="markSent(${l.id},this)">Mark as sent</button>
            <button class="btn btn-sm" onclick="regenOne(${l.id})">Regenerate</button>
          </div>
        </div>`;
      output.appendChild(card);
    } catch(err) {
      if(i===0) output.innerHTML='';
      output.innerHTML += `<div class="card" style="margin-bottom:12px;color:#b91c1c;">Error generating email for ${l.org}. Check API connection.</div>`;
    }
  }
  btn.disabled = false;
}

function copyEmail(btn, encoded) {
  navigator.clipboard.writeText(decodeURIComponent(encoded)).then(()=>{
    const orig = btn.textContent;
    btn.textContent='Copied!';
    setTimeout(()=>btn.textContent=orig, 2000);
  });
}

function markSent(id, btn) {
  const l = leads.find(x=>x.id===id);
  const sentAt = new Date().toISOString();
  if(l) { l.status = 'Emailed'; l.sent_at = sentAt; }
  updateMetrics();
  renderPipeline();
  patchLead(id, { status: 'Emailed', sent_at: sentAt }).catch(err => console.error('Failed to save sent_at:', err));
  btn.textContent='✓ Marked sent';
  btn.disabled=true;
  toast('Lead marked as Emailed.');
}

function regenOne(id) {
  const was = new Set(selectedLeads);
  selectedLeads.clear();
  selectedLeads.add(id);
  generateEmails().then(()=>{ selectedLeads.clear(); was.forEach(id=>selectedLeads.add(id)); });
}

// ── Pipeline ─────────────────────────────────────────────────────────────────
function renderPipeline() {
  const board = document.getElementById('pipeline-board');
  board.innerHTML = STAGES.map(stage => {
    const items = leads.filter(l=>l.status===stage);
    return `<div class="pipeline-col">
      <div class="pipeline-col-header">
        <span class="pipeline-col-title">${stage}</span>
        <span class="pipeline-count">${items.length}</span>
      </div>
      ${items.length ? items.map(l=>`
        <div class="pipeline-item" onclick="showPanel('leads')">
          <div class="pipeline-item-org">${l.org}</div>
          <div class="pipeline-item-detail">${l.contact||l.title||l.location}</div>
          ${l.location?`<div style="font-size:10px;color:var(--text-hint);margin-top:2px;">${l.location}</div>`:''}
        </div>`).join('') : '<div style="font-size:12px;color:var(--text-hint);padding:8px 0;">No leads</div>'}
    </div>`;
  }).join('');
}

// ── AI Lead Discovery ─────────────────────────────────────────────────────────
function renderDiscoverFilters() {
  const grid = document.getElementById('discover-filters-grid');
  if (!grid) return;
  const filters = activeCampaign.config.discover_filters;
  grid.innerHTML = Object.entries(filters).map(([key, filter]) => `
    <div>
      <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 5px;">${filter.label}</label>
      <select id="filter-${key}">
        ${Object.entries(filter.options).map(([optKey, opt]) => `<option value="${optKey}">${opt.label}</option>`).join('')}
      </select>
    </div>`).join('');
}

function renderKnownCustomers() {
  const section = document.getElementById('known-customers-section');
  const grid = document.getElementById('known-customers-grid');
  if (!section || !grid) return;
  const customers = activeCampaign.config.known_customers || [];
  if (!customers.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  grid.innerHTML = customers.map(c => {
    const initials = c.org.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    return `<div class="lead-card" style="padding: 12px;">
      <div class="lead-avatar" style="background: var(--accent-tint); color: var(--orange);">${initials}</div>
      <div class="lead-body">
        <div class="lead-name">${c.org}</div>
        <div class="lead-meta">${c.type}${c.location ? ' · ' + c.location : ''}</div>
      </div>
    </div>`;
  }).join('');
}

async function runDiscover() {
  const filters = activeCampaign.config.discover_filters;
  const promptTokens = {};
  Object.keys(filters).forEach(key => {
    const val = document.getElementById(`filter-${key}`).value;
    promptTokens[key + '_desc'] = filters[key].options[val]?.prompt_text || '';
  });
  const keywords = document.getElementById('keyword-input').value;
  const results = document.getElementById('discover-results');

  results.innerHTML = `<div class="loading"><div class="spinner"></div>Searching for matching leads…</div>`;

  const prompt = fillTemplate(activeCampaign.config.discover_prompt_template, { ...promptTokens, keywords });

  try {
    const resp = await fetch('/api/discover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, campaignId: activeCampaign.id }),
    });
    const items = await resp.json();
    if (!resp.ok) throw new Error(items.error || 'Request failed');
    window._discovered = items;

    results.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-size:13px;font-weight:600;">${items.length} leads found</div>
        <button class="btn btn-sm btn-primary" onclick="addAllDiscovered()">Add all to leads →</button>
      </div>`;

    items.forEach((item,i) => {
      const initials = item.org.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
      const alreadyAdded = leads.some(l=>l.org===item.org);
      const div = document.createElement('div');
      div.className = 'lead-card';
      div.innerHTML = `
        <div class="lead-avatar">${initials}</div>
        <div class="lead-body">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="lead-name">${item.org}</div>
            <span class="badge badge-discovered">${item.type}</span>
          </div>
          <div class="lead-meta">${item.contact_title} · ${item.location}${item.estimated_students&&item.estimated_students!=='Unknown'?' · ~'+item.estimated_students+' students':''}</div>
          <div class="lead-reason">${item.reason}</div>
          ${item.email?`<div style="font-size:11px;color:var(--text-muted);">${item.email}</div>`:''}
        </div>
        <div style="flex-shrink:0;">
          ${alreadyAdded
            ? '<span style="font-size:12px;color:var(--text-hint);">Already added</span>'
            : `<button class="btn btn-sm btn-primary" id="disc-btn-${i}" onclick="addOneDiscovered(${i},this)">+ Add</button>`}
        </div>`;
      results.appendChild(div);
    });
  } catch(e) {
    results.innerHTML = `<div style="color:#b91c1c;font-size:13px;padding:16px 0;">Could not parse results. Try again or check your API connection.<br><small>${e.message}</small></div>`;
  }
}

async function addOneDiscovered(i, btn) {
  const item = window._discovered?.[i];
  if(!item) return;
  try {
    const created = await createLead({org:item.org,contact:item.contact_name||'',first_name:item.first_name||null,email:item.email||'',title:item.contact_title,location:item.location,type:item.type,status:'New',source:'discovered',campaign_id:activeCampaign.id});
    leads.push(created);
    btn.textContent='✓ Added';
    btn.disabled=true;
    updateMetrics();
    toast(`${item.org} added to leads.`);
  } catch(e) {
    toast('Failed to add lead.');
  }
}

async function addAllDiscovered() {
  let added=0;
  for(const item of (window._discovered||[])) {
    if(!leads.find(l=>l.org===item.org)) {
      try {
        const created = await createLead({org:item.org,contact:item.contact_name||'',first_name:item.first_name||null,email:item.email||'',title:item.contact_title,location:item.location,type:item.type,status:'New',source:'discovered',campaign_id:activeCampaign.id});
        leads.push(created);
        added++;
      } catch(e) {}
    }
  }
  updateMetrics();
  showPanel('leads');
  toast(`${added} leads added.`);
}


// ── Review Queue ──────────────────────────────────────────────────────────────
let _reviewQueueCache = [];

async function loadReviewQueue() {
  const res = await fetch(`/api/email-queue?campaign_id=${activeCampaign.id}&status=pending_review`);
  if (!res.ok) throw new Error('Failed to load review queue');
  return res.json();
}

async function generateDraftsNow() {
  const btn = document.getElementById('generate-drafts-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const res = await fetch('/api/cron/generate-drafts', { cache: 'no-store' });
    const data = await res.json();
    const mine = data.results?.find(r => r.campaign === activeCampaign.slug);
    toast(`Drafted ${mine?.drafted ?? 0} new email${mine?.drafted === 1 ? '' : 's'}.`);
    await renderReviewQueue();
  } catch (e) {
    toast('Failed to generate drafts.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generate today's drafts"; }
  }
}

async function renderReviewQueue() {
  const list = document.getElementById('review-queue-list');
  const summary = document.getElementById('review-queue-summary');
  if (!list) return;
  try {
    _reviewQueueCache = await loadReviewQueue();
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Failed to load review queue.</div>';
    return;
  }
  const navCount = document.getElementById('nav-review-count');
  if (navCount) navCount.textContent = _reviewQueueCache.length;
  if (summary) summary.textContent = `${_reviewQueueCache.length} draft${_reviewQueueCache.length === 1 ? '' : 's'} awaiting review`;
  if (!_reviewQueueCache.length) {
    list.innerHTML = '<div class="empty-state">No drafts waiting. Click "Generate today\'s drafts" to start.</div>';
    return;
  }
  list.innerHTML = _reviewQueueCache.map(item => `
    <div class="email-card" data-queue-id="${item.id}">
      <div class="email-card-header">
        <div style="flex:1;">
          <div style="font-weight:600;font-size:14px;">${item.leads?.org || 'Unknown lead'}</div>
          <div class="email-subject">Subject</div>
          <input type="text" class="queue-subject-input" value="${(item.subject || '').replace(/"/g, '&quot;')}" style="font-size:13px;font-weight:600;border:1px solid var(--border);border-radius:4px;width:100%;padding:4px 6px;margin-top:2px;">
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <button class="btn btn-sm btn-orange" onclick="approveAndSend('${item.id}')" ${item.leads?.email ? '' : 'disabled title="No email on record for this lead"'}>Approve & Send</button>
          <button class="btn btn-sm" onclick="skipDraft('${item.id}')">Skip</button>
        </div>
      </div>
      <div class="email-card-body">
        <textarea class="queue-body-input" rows="8" style="width:100%;border:1px solid var(--border);border-radius:4px;padding:8px;font-size:13px;line-height:1.8;font-family:inherit;">${item.body || ''}</textarea>
      </div>
    </div>`).join('');
}

async function approveAndSend(queueId) {
  const item = _reviewQueueCache.find(q => q.id === queueId);
  if (!item) return;
  if (!item.leads?.email) { toast('No email on record for this lead.'); return; }
  const card = document.querySelector(`[data-queue-id="${queueId}"]`);
  const subject = card.querySelector('.queue-subject-input').value;
  const body = card.querySelector('.queue-body-input').value;

  if (activeCampaign.sender_email) {
    // Real send via Resend — used once a campaign has a configured sender.
    const from = activeCampaign.sender_name
      ? `${activeCampaign.sender_name} <${activeCampaign.sender_email}>`
      : activeCampaign.sender_email;
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: item.leads.email, subject, text: body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');

      const sentAt = new Date().toISOString();
      await fetch(`/api/email-queue/${queueId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent', sent_at: sentAt }),
      });
      await fetch(`/api/leads/${item.lead_id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Emailed', sent_at: sentAt }),
      });
      toast('Email sent.');
    } catch (e) {
      toast('Failed to send — nothing marked as sent, draft left in review queue.');
      renderReviewQueue();
      return;
    }
  } else {
    // TEMPORARY fallback for campaigns with no configured sender yet
    // (the other demo campaigns). Remove this branch's condition once every
    // campaign has a real sender_email — until then, leave as-is.
    _emailStore[item.lead_id] = { to: item.leads.email, subject, body };
    openInGmail(item.lead_id);

    const sentAt = new Date().toISOString();
    try {
      await fetch(`/api/email-queue/${queueId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent', sent_at: sentAt }),
      });
      await fetch(`/api/leads/${item.lead_id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Emailed', sent_at: sentAt }),
      });
      toast('Opened in Gmail — marked as sent.');
    } catch (e) {
      toast('Opened in Gmail, but failed to update status — check manually.');
    }
  }
  renderReviewQueue();
}

async function skipDraft(queueId) {
  try {
    await fetch(`/api/email-queue/${queueId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skipped' }),
    });
    toast('Draft skipped.');
  } catch (e) {
    toast('Failed to skip draft.');
  }
  renderReviewQueue();
}

async function init() {
  try {
    campaigns = await loadCampaigns();
    const savedSlug = localStorage.getItem('activeCampaignSlug');
    activeCampaign = campaigns.find(c => c.slug === savedSlug) || campaigns[0];
  } catch (e) {
    toast('Failed to load campaigns.');
    return;
  }
  setCampaignColors(activeCampaign);
  renderTopbarLogo();
  renderCampaignSwitcher();
  applyCampaignConfig();
  renderDiscoverFilters();
  renderKnownCustomers();
  try {
    leads = await loadLeads();
  } catch (e) {
    leads = [];
    toast('Failed to load leads from server.');
  }
  updateMetrics();
  renderLeads();
  renderPipeline();
}

// ── Mount: expose handlers used by inline onclick/onchange attributes ────────
export function initApp() {
  if (typeof window === 'undefined') return;
  Object.assign(window, {
    showPanel, runDiscover, importExistingCustomers, importCSV, openAddLead, submitAddLead,
    toggleSelectAll, toggleLead, updateStatus, bulkCompose, bulkMarkEmailed, selectAllCompose,
    generateEmails, copyEmail, markSent, regenOne, openInGmail, addOneDiscovered, addAllDiscovered,
    toggleComposeLead,
    toggleCampaignMenu, selectCampaign,
    filterLeads,
    deleteLead, deleteSelectedLeads,
    generateDraftsNow, approveAndSend, skipDraft,
  });
  init();
}
