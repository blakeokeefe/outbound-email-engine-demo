'use client';

import { useEffect } from 'react';
import { initApp } from '@/lib/appLogic';

const APP_HTML = `
<div id="toast"></div>

<div class="app-shell">
  <!-- Topbar -->
  <header class="topbar">
    <div class="topbar-logo">
      <div class="flag">
        <svg viewBox="0 0 16 16"><path d="M3 2v12M3 2l10 3-10 3" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <span class="topbar-title" id="topbar-title-text">Acme Crosswalk Safety</span>
      <span class="topbar-sub">Outbound Email Engine &middot; Demo (fictional data)</span>
    </div>
    <div class="topbar-metrics">
      <div class="tmetric"><div class="tmetric-val" id="hm-total">—</div><div class="tmetric-label">Total leads</div></div>
      <div class="tmetric"><div class="tmetric-val" id="hm-sent">—</div><div class="tmetric-label">Emailed</div></div>
      <div class="tmetric"><div class="tmetric-val" id="hm-replied">—</div><div class="tmetric-label">Replied</div></div>
      <div class="tmetric"><div class="tmetric-val" id="hm-meetings">—</div><div class="tmetric-label">Meetings</div></div>
    </div>
  </header>

  <div class="main">
    <!-- Sidebar -->
    <nav class="sidebar">
      <div class="nav-section" style="margin-bottom: 16px;">
        <div style="padding: 0 8px 12px; font-size: 11px; color: var(--text-hint);">Active campaign:</div>
        <div style="padding: 0 8px; margin-bottom: 12px; position: relative;">
          <button class="product-badge" id="campaign-switcher-btn" onclick="toggleCampaignMenu()" style="border:none;cursor:pointer;">Loading…</button>
          <div id="campaign-menu" style="display:none; position:absolute; top:100%; left:8px; right:8px; margin-top:4px; background:white; border:1px solid var(--border); border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.1); z-index:50; overflow:hidden;"></div>
        </div>
      </div>
      <div class="nav-section">
        <div class="nav-label">Outreach</div>
        <button class="nav-item active" onclick="showPanel('discover')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="m11 11 3 3" stroke-linecap="round"/></svg>
          Discover
        </button>
        <button class="nav-item" onclick="showPanel('leads')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="5" r="2.5"/><path d="M1 13c0-2.8 2.2-5 5-5h0c2.8 0 5 2.2 5 5"/><path d="M11 2a2.5 2.5 0 0 1 0 5M15 13c0-2.2-1.6-4-3.5-4.5"/></svg>
          Leads
          <span class="nav-count" id="nav-leads-count">9</span>
        </button>

      </div>
      <div class="nav-section" style="margin-top: 16px;">
        <div class="nav-label">Tracking</div>
        <button class="nav-item" onclick="showPanel('pipeline')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="2" width="3" height="12" rx="1"/><rect x="6" y="5" width="3" height="9" rx="1"/><rect x="11" y="3" width="3" height="11" rx="1"/></svg>
          Pipeline
        </button>
      </div>
      <div class="nav-section" style="margin-top: 16px;">
        <div class="nav-label">Automation</div>
        <button class="nav-item" onclick="showPanel('review')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8h12M2 4h12M2 12h8" stroke-linecap="round"/></svg>
          Review
          <span class="nav-count" id="nav-review-count">0</span>
        </button>
      </div>
    </nav>

    <!-- Content -->
    <main class="content">

      <!-- DISCOVER PANEL -->
      <div class="panel active" id="panel-discover">
        <div class="page-header">
          <div class="page-title">Discover leads</div>
          <div class="page-subtitle" id="page-discover-subtitle">AI searches for school districts and transportation buyers matching your existing customer profile.</div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div class="section-label">Search parameters</div>
          <div id="discover-filters-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 12px;"></div>
          <div style="display: flex; gap: 10px;">
            <input type="text" id="keyword-input" style="flex: 1;" placeholder="Keywords e.g. pedestrian safety, crosswalk, student transportation..." />
            <button class="btn btn-orange" onclick="runDiscover()">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1c3.9 0 7 3.1 7 7s-3.1 7-7 7-7-3.1-7-7 3.1-7 7-7zM5 8h3M8 5v3" stroke-linecap="round"/></svg>
              Find leads with AI
            </button>
          </div>
        </div>

        <!-- Known customers block -->
        <div id="known-customers-section" style="margin-bottom: 16px;">
          <div class="section-label">Known customers — import as warm leads</div>
          <div id="known-customers-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;"></div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm btn-primary" onclick="importExistingCustomers()">Import all as leads</button>
            <label class="btn btn-sm" style="cursor: pointer;">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1v10M4 7l4 4 4-4M2 13h12" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Import CSV
              <input type="file" accept=".csv" style="display:none;" onchange="importCSV(this)">
            </label>
          </div>
        </div>

        <div id="discover-results"></div>
      </div>

      <!-- LEADS PANEL -->
      <div class="panel" id="panel-leads">
        <div class="page-header">
          <div class="page-title">Leads</div>
          <div class="page-subtitle">All contacts across discovery sources. Update status, add notes, and select for email campaigns.</div>
        </div>

        <div class="metrics-grid">
          <div class="metric-card accent"><div class="metric-val" id="m-total">0</div><div class="metric-label">Total leads</div><div class="metric-sub">across all stages</div></div>
          <div class="metric-card"><div class="metric-val" id="m-new">0</div><div class="metric-label">New</div><div class="metric-sub">not yet contacted</div></div>
          <div class="metric-card"><div class="metric-val" id="m-sent">0</div><div class="metric-label">Emailed</div><div class="metric-sub">awaiting reply</div></div>
          <div class="metric-card"><div class="metric-val" id="m-replied">0</div><div class="metric-label">Replied / Meetings</div><div class="metric-sub">engaged prospects</div></div>
        </div>

        <div class="row-between">
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <input type="text" id="lead-search" placeholder="Search leads…" oninput="filterLeads()" style="width: 200px;" />
            <select id="lead-status-filter" onchange="filterLeads()">
              <option value="all">All statuses</option>
              <option value="New">New</option>
              <option value="Emailed">Emailed</option>
              <option value="Replied">Replied</option>
              <option value="Meeting">Meeting booked</option>
            </select>
            <select id="lead-source-filter" onchange="filterLeads()">
              <option value="all">All sources</option>
              <option value="existing">Existing customers</option>
              <option value="discovered">AI discovered</option>
              <option value="imported">CSV import</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm btn-primary" onclick="openAddLead()">+ Add lead</button>
          </div>
        </div>

        <!-- Add lead form -->
        <div id="add-lead-form" style="display: none; margin-bottom: 16px;">
          <div class="card">
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 14px;">Add new lead</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <div><label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">Organization *</label><input type="text" id="nl-org" placeholder="School district or org name" /></div>
              <div><label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">Contact name</label><input type="text" id="nl-contact" placeholder="Full name" /></div>
              <div><label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">Email</label><input type="email" id="nl-email" placeholder="email@example.org" /></div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 14px;">
              <div><label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">Title / role</label><input type="text" id="nl-title" placeholder="Transportation Director" /></div>
              <div><label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">Location</label><input type="text" id="nl-location" placeholder="City, State" /></div>
              <div><label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">Type</label>
                <select id="nl-type">
                  <option>School District</option>
                  <option>City/DOT</option>
                  <option>Private School</option>
                  <option>Charter School</option>
                  <option>Other</option>
                </select>
              </div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-sm btn-primary" onclick="submitAddLead()">Add lead</button>
              <button class="btn btn-sm" onclick="document.getElementById('add-lead-form').style.display='none'">Cancel</button>
            </div>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width: 36px;"><input type="checkbox" class="cb" id="select-all" onchange="toggleSelectAll(this.checked)"></th>
                <th style="width: 28%;">Organization</th>
                <th style="width: 17%;">Contact</th>
                <th style="width: 15%;">Location</th>
                <th style="width: 10%;">Type</th>
                <th style="width: 10%;">Source</th>
                <th style="width: 8%;">Status</th>
                <th style="width: 120px;">Update</th>
              </tr>
            </thead>
            <tbody id="leads-tbody"></tbody>
          </table>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 14px;" id="bulk-actions">
          <button class="btn btn-sm btn-orange" onclick="bulkCompose()">Compose emails for selected</button>
          <button class="btn btn-sm" onclick="bulkMarkEmailed()">Mark selected as Emailed</button>
          <button class="btn btn-sm" onclick="deleteSelectedLeads()">Delete selected</button>
        </div>
      </div>


      <!-- PIPELINE PANEL -->
      <div class="panel" id="panel-pipeline">
        <div class="page-header">
          <div class="page-title">Pipeline</div>
          <div class="page-subtitle">Track all leads across stages. Update status from the Leads table.</div>
        </div>

        <div class="pipeline-board" id="pipeline-board"></div>
      </div>

      <!-- REVIEW PANEL -->
      <div class="panel" id="panel-review">
        <div class="page-header">
          <div class="page-title">Review queue</div>
          <div class="page-subtitle">AI-drafted emails awaiting your review. Edit if needed, then approve to open in Gmail, or skip.</div>
        </div>
        <div class="row-between">
          <div id="review-queue-summary" style="font-size:13px;color:var(--text-muted);"></div>
          <button class="btn btn-sm btn-orange" id="generate-drafts-btn" onclick="generateDraftsNow()">Generate today's drafts</button>
        </div>
        <div id="review-queue-list"></div>
      </div>

    </main>
  </div>
</div>
`;

export default function HomePage() {
  useEffect(() => {
    initApp();
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: APP_HTML }} />;
}
