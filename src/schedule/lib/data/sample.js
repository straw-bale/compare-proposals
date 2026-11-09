import { generateId, toISO, toWeekday } from '../utils/dates.js';

// Default notes shown in the legend footer for new projects
const DEFAULT_NOTES = [
  'Project schedules are reliant on timely Owner input and approvals.',
  'R3A does not provide accurate projections for construction duration or timelines beyond the Construction Documentation phase.',
].join('\n');

// Add N weeks to a Date, returning a new Date
function w(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n * 7);
  return d;
}

// First day of month N months after date
function mEnd(date, n = 2) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

// FF&E package: spec runs DD through CDs, the PO is approved ~16 weeks before
// install (but no sooner than 2 weeks after CDs), procurement fills the lead time,
// and installation takes the last 4 weeks of construction.
function ffe(specStart, cdEnd, conEnd, firstId) {
  const instS = w(conEnd, -4);
  const po    = new Date(Math.max(w(cdEnd, 2), w(instS, -16)));
  const poISO = toWeekday(toISO(po));
  return {
    tasks: [
      { id:firstId,     name:'FF&E Design & Specification',  type:'bar', color:'#00914D', start: toISO(specStart), end: toISO(cdEnd) },
      { id:firstId + 1, name:'FF&E Lead Time & Procurement', type:'bar', color:'#282829', start: poISO,            end: toISO(instS) },
      { id:firstId + 2, name:'FF&E Installation',            type:'bar', color:'#6D245D', start: toISO(instS),     end: toISO(conEnd) },
    ],
    approval: { text:'FF&E Purchase Order', date: poISO },
  };
}

export function createSampleProject() {
  const base = new Date('2026-06-01');

  const prS   = base,          prE   = w(base, 8);     // Programming
  const sdS   = prE,           sdE   = w(sdS, 12);     // Schematic Design
  const r1S   = sdE,           r1E   = w(r1S, 4);      // SD Client Review
  const ddS   = r1E,           ddE   = w(ddS, 12);     // Design Development
  const r2S   = ddE,           r2E   = w(r2S, 4);      // DD Client Review
  const cdS   = r2E,           cdE   = w(cdS, 10);     // Construction Documents
  const pmSub = cdE;
  const pmRvS = pmSub,         pmRvE = w(pmRvS, 4);    // Permit Review
  const bidS  = pmSub,         bidE  = w(bidS, 4);     // Bidding
  const conS  = pmRvE,         conE  = w(conS, 26);    // Construction
  const clS   = w(conE, -6),   clE   = w(clS, 8);      // Closeout overlaps end of construction
  const occ   = conE;
  const ff    = ffe(ddS, cdE, conE, 14);

  return {
    id: generateId(),
    title:    'Sample Project',
    notes:    DEFAULT_NOTES,
    date:     'June 1, 2026',
    number:   'Project No. 00001',
    client:   'Sample Client',
    viewStart:  toISO(new Date(base.getFullYear(), base.getMonth() - 1, 1)),
    viewEnd:    toISO(mEnd(occ, 1)),
    todayMark:  toISO(new Date()),
    nextTaskId: 17,
    tasks: [
      { id:1,  name:'Project Kick-Off',              type:'milestone', date: toISO(base) },
      { id:2,  name:'Programming',                   type:'bar', color:'#00914D', start: toISO(prS),   end: toISO(prE) },
      { id:3,  name:'Schematic Design',              type:'bar', color:'#00914D', start: toISO(sdS),   end: toISO(sdE) },
      { id:4,  name:'SD Client Review',              type:'bar', color:'#949494', start: toISO(r1S),   end: toISO(r1E) },
      { id:5,  name:'Design Development',            type:'bar', color:'#00914D', start: toISO(ddS),   end: toISO(ddE) },
      { id:6,  name:'DD Client Review',              type:'bar', color:'#949494', start: toISO(r2S),   end: toISO(r2E) },
      { id:7,  name:'Construction Documents',        type:'bar', color:'#00914D', start: toISO(cdS),   end: toISO(cdE) },
      { id:8,  name:'Permit Submission',             type:'milestone', date: toISO(pmSub) },
      { id:9,  name:'Permit Review',                 type:'bar', color:'#D83968', start: toISO(pmRvS), end: toISO(pmRvE) },
      { id:10, name:'Bidding & Procurement',         type:'bar', color:'#282829', start: toISO(bidS),  end: toISO(bidE) },
      { id:11, name:'Construction',                  type:'bar', color:'#6D245D', start: toISO(conS),  end: toISO(conE),
        isEstimate: true },
      ...ff.tasks,
      { id:12, name:'As-Built / Closeout Documents', type:'bar', color:'#282829', start: toISO(clS),   end: toISO(clE) },
      { id:13, name:'Project Occupancy',             type:'milestone', date: toISO(occ), label: 'Beneficial Occupancy' },
    ],
    legend: {
      deliverables: [
        { num:1, text:'Programming Document',        label:'', date: toISO(prE) },
        { num:2, text:'Schematic Design Drawings',   label:'', date: toISO(sdE) },
        { num:3, text:'Design Development Drawings', label:'', date: toISO(ddE) },
        { num:4, text:'100% Construction Drawings',  label:'', date: toISO(cdE) },
      ],
      milestones: [
        { color:'#282829', code:'BK', text:'Bidding Kick-Off',                         date: toISO(bidS) },
        { color:'#6D245D', code:'SC', text:'Substantial Completion',                   date: toISO(conE) },
        { color:'#20ABE2', code:'OC', text:'Project Occupancy / Beneficial Occupancy', date: toISO(occ)  },
      ],
      estimates: [
        { color:'#00914D', code:'SD', text:'Schematic Design',      date: toISO(sdE) },
        { color:'#00914D', code:'DD', text:'Design Development',     date: toISO(ddE) },
      ],
      approvals: [{ text:'Building Permit Approval', date: toISO(pmRvE) }, ff.approval],
    },
  };
}

export function createBlankProject() {
  const base = new Date();
  base.setDate(1);
  const ys = toISO(base);
  const ye = toISO(mEnd(base, 12));
  return {
    id: generateId(),
    title: '',
    notes:    DEFAULT_NOTES,
    date: '', number: '', client: '',
    viewStart:  ys,
    viewEnd:    ye,
    todayMark:  toISO(new Date()),
    nextTaskId: 2,
    tasks: [
      { id:1, name:'Project Kick-Off', type:'milestone', date: ys },
    ],
    legend: {
      deliverables: [], milestones: [], estimates: [], approvals: [],
    },
  };
}

// ─── Small template ────────────────────────────────────────────────────────────
// Renovation / Tenant Improvement / Small new construction
// ~12 months: Programming → SD → DD → DD Review → CDs → CD Review → Bidding → Construction → Closeout
export function createSmallTemplate() {
  const base = new Date(); base.setDate(1);

  const prS   = base,          prE   = w(base, 3);   // programming
  const sdS   = prE,           sdE   = w(sdS, 6);
  const ddS   = sdE,           ddE   = w(ddS, 6);
  const ddrS  = ddE,           ddrE  = w(ddrS, 3);   // client review after DD
  const cdS   = ddrE,          cdE   = w(cdS, 6);
  const cdrS  = cdE,           cdrE  = w(cdrS, 3);   // client review after CDs
  const bidS  = cdrE,          bidE  = w(bidS, 4);
  const conS  = bidE,          conE  = w(conS, 12);
  const clS   = conE,          clE   = w(clS, 3);
  const occ   = clE;
  const pmSub  = cdE;
  const pmRvE  = conS;
  const ff     = ffe(ddS, cdE, conE, 15);

  return {
    id: generateId(),
    title: '',
    notes:    DEFAULT_NOTES,
    date: '', number: '', client: '',
    viewStart:  toISO(new Date(base.getFullYear(), base.getMonth() - 1, 1)),
    viewEnd:    toISO(mEnd(occ, 1)),
    todayMark:  toISO(new Date()),
    nextTaskId: 18,
    tasks: [
      { id:1,  name:'Project Kick-Off',         type:'milestone', date: toISO(base) },
      { id:2,  name:'Programming',              type:'bar', color:'#00914D', start: toISO(prS),  end: toISO(prE) },
      { id:3,  name:'Schematic Design',         type:'bar', color:'#00914D', start: toISO(sdS),  end: toISO(sdE) },
      { id:4,  name:'Design Development',       type:'bar', color:'#00914D', start: toISO(ddS),  end: toISO(ddE) },
      { id:5,  name:'DD Client Review',         type:'bar', color:'#949494', start: toISO(ddrS), end: toISO(ddrE) },
      { id:6,  name:'Construction Documents',   type:'bar', color:'#00914D', start: toISO(cdS),  end: toISO(cdE) },
      { id:7,  name:'CD Client Review',         type:'bar', color:'#949494', start: toISO(cdrS), end: toISO(cdrE) },
      { id:12, name:'Permit Submission',        type:'milestone', date: toISO(pmSub) },
      { id:13, name:'Permit Review',            type:'bar', color:'#D83968', start: toISO(pmSub), end: toISO(pmRvE) },
      { id:8,  name:'Bidding & Procurement',    type:'bar', color:'#282829', start: toISO(bidS), end: toISO(bidE) },
      { id:9,  name:'Construction',             type:'bar', color:'#6D245D', start: toISO(conS), end: toISO(conE),
        isEstimate: true },
      ...ff.tasks,
      { id:10, name:'As-Built / Closeout',      type:'bar', color:'#282829', start: toISO(clS),  end: toISO(clE) },
      { id:11, name:'Project Occupancy',        type:'milestone', date: toISO(occ) },
    ],
    legend: {
      deliverables: [
        { num:1, text:'Programming Document',        label:'', date: toISO(prE) },
        { num:2, text:'Schematic Design Drawings',   label:'', date: toISO(sdE) },
        { num:3, text:'Design Development Drawings', label:'', date: toISO(ddE) },
        { num:4, text:'100% Construction Drawings',  label:'', date: toISO(cdE) },
      ],
      milestones: [
        { color:'#282829', code:'BK', text:'Bidding Kick-Off',                         date: toISO(bidS) },
        { color:'#6D245D', code:'SC', text:'Substantial Completion',                   date: toISO(conE) },
        { color:'#20ABE2', code:'OC', text:'Project Occupancy / Beneficial Occupancy', date: toISO(occ)  },
      ],
      estimates: [
        { color:'#00914D', code:'SD', text:'Schematic Design',      date: toISO(sdE) },
        { color:'#00914D', code:'DD', text:'Design Development',     date: toISO(ddE) },
      ],
      approvals: [{ text:'Building Permit Approval', date: toISO(pmRvE) }, ff.approval],
    },
  };
}

// ─── Medium template ───────────────────────────────────────────────────────────
// Commercial / Institutional project
// ~23 months: Programming → SD → 50% DD → 95% CDs → 100% CDs → Final CDs with client reviews
export function createMediumTemplate() {
  const base = new Date(); base.setDate(1);

  const prS   = base,          prE   = w(base, 4);   // programming
  const sdS   = prE,           sdE   = w(sdS, 8);
  const r1S   = sdE,           r1E   = w(r1S, 4);
  const d50S  = r1E,           d50E  = w(d50S, 10);
  const r2S   = d50E,          r2E   = w(r2S, 4);
  const d95S  = r2E,           d95E  = w(d95S, 8);
  const r3S   = d95E,          r3E   = w(r3S, 4);
  const d100S = r3E,           d100E = w(d100S, 6);
  const fcdS  = d100E,         fcdE  = w(fcdS, 4);
  const bidS  = fcdE,          bidE  = w(bidS, 4);
  const conS  = bidE,          conE  = w(conS, 26);
  const clS   = conE,          clE   = w(clS, 6);
  const occ   = clE;
  const pmSub  = fcdE;
  const pmRvE  = conS;
  const ff     = ffe(d50S, fcdE, conE, 18);

  return {
    id: generateId(),
    title: '',
    notes:    DEFAULT_NOTES,
    date: '', number: '', client: '',
    viewStart:  toISO(new Date(base.getFullYear(), base.getMonth() - 1, 1)),
    viewEnd:    toISO(mEnd(occ, 1)),
    todayMark:  toISO(new Date()),
    nextTaskId: 21,
    tasks: [
      { id:1,  name:'Project Kick-Off',              type:'milestone', date: toISO(base) },
      { id:2,  name:'Programming',                   type:'bar', color:'#00914D', start: toISO(prS),   end: toISO(prE) },
      { id:3,  name:'Schematic Design',              type:'bar', color:'#00914D', start: toISO(sdS),   end: toISO(sdE) },
      { id:4,  name:'SD Client Review',              type:'bar', color:'#949494', start: toISO(r1S),   end: toISO(r1E) },
      { id:5,  name:'50% Design Development',        type:'bar', color:'#00914D', start: toISO(d50S),  end: toISO(d50E) },
      { id:6,  name:'50% Design Review',             type:'bar', color:'#949494', start: toISO(r2S),   end: toISO(r2E) },
      { id:7,  name:'95% Construction Documents',    type:'bar', color:'#00914D', start: toISO(d95S),  end: toISO(d95E) },
      { id:8,  name:'95% Design Review',             type:'bar', color:'#949494', start: toISO(r3S),   end: toISO(r3E) },
      { id:9,  name:'100% Construction Documents',   type:'bar', color:'#00914D', start: toISO(d100S), end: toISO(d100E) },
      { id:10, name:'Final Construction Documents',  type:'bar', color:'#00914D', start: toISO(fcdS),  end: toISO(fcdE) },
      { id:15, name:'Permit Submission',             type:'milestone', date: toISO(pmSub) },
      { id:16, name:'Permit Review',                 type:'bar', color:'#D83968', start: toISO(pmSub), end: toISO(pmRvE) },
      { id:11, name:'Bidding & Procurement',         type:'bar', color:'#282829', start: toISO(bidS),  end: toISO(bidE) },
      { id:12, name:'Construction',                  type:'bar', color:'#6D245D', start: toISO(conS),  end: toISO(conE),
        isEstimate: true },
      ...ff.tasks,
      { id:13, name:'As-Built / Closeout Documents', type:'bar', color:'#282829', start: toISO(clS),   end: toISO(clE) },
      { id:14, name:'Project Occupancy',             type:'milestone', date: toISO(occ) },
    ],
    legend: {
      deliverables: [
        { num:1, text:'Programming Document',        label:'', date: toISO(prE) },
        { num:2, text:'Schematic Design Drawings',   label:'', date: toISO(sdE) },
        { num:3, text:'Design Development Drawings', label:'', date: toISO(d50E) },
        { num:4, text:'100% Construction Drawings',  label:'', date: toISO(fcdE) },
      ],
      milestones: [
        { color:'#282829', code:'BK', text:'Bidding Kick-Off',                         date: toISO(bidS) },
        { color:'#6D245D', code:'SC', text:'Substantial Completion',                   date: toISO(conE) },
        { color:'#20ABE2', code:'OC', text:'Project Occupancy / Beneficial Occupancy', date: toISO(occ)  },
      ],
      estimates: [
        { color:'#00914D', code:'SD', text:'Schematic Design',      date: toISO(sdE) },
        { color:'#00914D', code:'DD', text:'Design Development',     date: toISO(d50E) },
      ],
      approvals: [{ text:'Building Permit Approval', date: toISO(pmRvE) }, ff.approval],
    },
  };
}

// ─── Large template ────────────────────────────────────────────────────────────
// Large / Complex project
// ~36 months: Programming → full phase sequence with owner reviews, permitting, major construction
export function createLargeTemplate() {
  const base = new Date(); base.setDate(1);

  const prS    = base,         prE    = w(base, 6);   // programming
  const sdS    = prE,          sdE    = w(sdS, 10);
  const r1S    = sdE,          r1E    = w(r1S, 6);
  const d50S   = r1E,          d50E   = w(d50S, 12);
  const r2S    = d50E,         r2E    = w(r2S, 6);
  const d95S   = r2E,          d95E   = w(d95S, 10);
  const r3S    = d95E,         r3E    = w(r3S, 6);
  const d100S  = r3E,          d100E  = w(d100S, 8);
  const r4S    = d100E,        r4E    = w(r4S, 6);
  const fcdS   = r4E,          fcdE   = w(fcdS, 6);
  const pmSub  = fcdE;
  const pmRvS  = pmSub,        pmRvE  = w(pmRvS, 10);
  const bidS   = pmSub,        bidE   = w(bidS, 4);   // bidding overlaps permit start
  const pmApp  = pmRvE;
  const conS   = pmRvE,        conE   = w(conS, 60);
  const clS    = conE,         clE    = w(clS, 8);
  const occ    = clE;
  const ff     = ffe(d50S, fcdE, conE, 19);

  return {
    id: generateId(),
    title: '',
    notes:    DEFAULT_NOTES,
    date: '', number: '', client: '',
    viewStart:  toISO(new Date(base.getFullYear(), base.getMonth() - 1, 1)),
    viewEnd:    toISO(mEnd(occ, 1)),
    todayMark:  toISO(new Date()),
    nextTaskId: 22,
    tasks: [
      { id:1,  name:'Project Kick-Off',                type:'milestone', date: toISO(base) },
      { id:2,  name:'Programming',                     type:'bar', color:'#00914D', start: toISO(prS),   end: toISO(prE) },
      { id:3,  name:'Schematic Design',                type:'bar', color:'#00914D', start: toISO(sdS),   end: toISO(sdE) },
      { id:4,  name:'SD Owner Review',                 type:'bar', color:'#949494', start: toISO(r1S),   end: toISO(r1E) },
      { id:5,  name:'50% Design Development',          type:'bar', color:'#00914D', start: toISO(d50S),  end: toISO(d50E) },
      { id:6,  name:'50% Owner Review',                type:'bar', color:'#949494', start: toISO(r2S),   end: toISO(r2E) },
      { id:7,  name:'95% Construction Documents',      type:'bar', color:'#00914D', start: toISO(d95S),  end: toISO(d95E) },
      { id:8,  name:'95% Owner Review',                type:'bar', color:'#949494', start: toISO(r3S),   end: toISO(r3E) },
      { id:9,  name:'100% Construction Documents',     type:'bar', color:'#00914D', start: toISO(d100S), end: toISO(d100E) },
      { id:10, name:'100% Owner Review',               type:'bar', color:'#949494', start: toISO(r4S),   end: toISO(r4E) },
      { id:11, name:'Final Construction Documents',    type:'bar', color:'#00914D', start: toISO(fcdS),  end: toISO(fcdE) },
      { id:12, name:'Permit Submission',               type:'milestone', date: toISO(pmSub) },
      { id:13, name:'Permit Review',                   type:'bar', color:'#D83968', start: toISO(pmRvS), end: toISO(pmRvE) },
      { id:14, name:'Bidding & Procurement',           type:'bar', color:'#282829', start: toISO(bidS),  end: toISO(bidE) },
      { id:16, name:'Construction',                    type:'bar', color:'#6D245D', start: toISO(conS),  end: toISO(conE),
        isEstimate: true },
      ...ff.tasks,
      { id:17, name:'As-Built / Closeout Documents',   type:'bar', color:'#282829', start: toISO(clS),   end: toISO(clE) },
      { id:18, name:'Project Occupancy',               type:'milestone', date: toISO(occ) },
    ],
    legend: {
      deliverables: [
        { num:1, text:'Programming Document',        label:'', date: toISO(prE) },
        { num:2, text:'Schematic Design Drawings',   label:'', date: toISO(sdE) },
        { num:3, text:'Design Development Drawings', label:'', date: toISO(d50E) },
        { num:4, text:'100% Construction Drawings',  label:'', date: toISO(fcdE) },
      ],
      milestones: [
        { color:'#282829', code:'BK', text:'Bidding Kick-Off',                         date: toISO(bidS) },
        { color:'#6D245D', code:'SC', text:'Substantial Completion',                   date: toISO(clS)  },
        { color:'#20ABE2', code:'OC', text:'Project Occupancy / Beneficial Occupancy', date: toISO(occ)  },
      ],
      estimates: [
        { color:'#00914D', code:'SD', text:'Schematic Design',      date: toISO(sdE) },
        { color:'#00914D', code:'DD', text:'Design Development',     date: toISO(d50E) },
      ],
      approvals: [
        { text:'Building Permit Approval', date: toISO(pmApp) },
        ff.approval,
      ],
    },
  };
}
