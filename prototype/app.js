const stage = document.getElementById('prototype-stage');
const dialog = document.getElementById('proposal-dialog');

const state = {
  screen: 'trips-motif',
  mode: 'pair',
  kept: 3,
  reviewed: 4,
};

const icons = {
  bag: '<svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14v12H5zM9 8V5h6v3M8 12v3m8-3v3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  compass: '<svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  profile: '<svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 21v-3c0-4 3-7 8-7s8 3 8 7v3z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};

function header(mobile, motif = false, active = 'trips') {
  const motifMarkup = motif ? `
    <svg class="header-motif" viewBox="0 0 1080 72" aria-hidden="true">
      <path d="M260 46c17-14 42-12 51 5 12-21 45-19 52 4 22-4 48-2 67 4"/>
      <path d="M528 54c105 1 177 1 268-4 64-3 118-4 190-2"/>
      <path d="M844 47h58l10-12h50l12 12h30m-85-12v-7h35v7m-24-7v-6m-28 25c3 7 10 7 13 0m50 0c3 7 10 7 13 0"/>
    </svg>` : '';

  if (mobile) {
    return `<header class="app-header">${motifMarkup}<span class="wordmark">Planitenary</span><button class="menu-button" aria-label="Open menu"><span class="hamburger"></span></button></header>`;
  }

  return `<header class="app-header">${motifMarkup}<span class="wordmark">Planitenary</span><nav class="header-nav" aria-label="App navigation">
    <button class="${active === 'trips' ? 'is-active' : ''}" data-route="trips-motif">${icons.bag} My Trips</button>
    <button class="${active === 'discover' ? 'is-active' : ''}" data-route="discover">${icons.compass} Discover</button>
    <button>${icons.profile} Profile⌄</button>
  </nav></header>`;
}

function mountainMotif() {
  return `<svg class="title-mountain" viewBox="0 0 220 64" aria-hidden="true"><path d="M5 52c25-10 49-12 72-2 13-22 34-34 56-39 18 10 32 22 44 40 16-7 29-5 40 2M94 52l39-41 17 40"/></svg>`;
}

function coastSketch() {
  return `<svg class="coastline-sketch" viewBox="0 0 430 74" preserveAspectRatio="none" aria-hidden="true"><path d="M0 54c47-19 74-30 117-24 32 4 47-11 77-20 31 13 48 31 82 32 42 2 76-7 154-1M0 61c56-14 84-22 122-13 31 8 65 0 93-9m-42 7 20-29 18 26 20-20 21 20m-124 10c-16-12-32-15-50-7M68 45l-2-17 11 13m-11-13-8 12"/></svg>`;
}

function tripRow(title, days, dates, image, cls = '') {
  return `<button class="trip-row" type="button"><span class="trip-row-image ${cls}"><img src="${image}" alt=""></span><span><h3>${title}</h3><span class="trip-row-meta"><span>▣ ${days}</span><span>◷ ${dates}</span></span></span><span class="chevron">›</span></button>`;
}

function tripsScreen(mobile, motif) {
  const clean = !motif;
  return `<article class="device ${mobile ? 'device-mobile' : 'device-desktop'}" aria-label="${mobile ? 'Mobile' : 'Desktop'} My Trips prototype">
    ${header(mobile, motif, 'trips')}
    <section class="screen mobile-screen">
      <div class="screen-inner">
        <div class="trips-title-row"><h1>My Trips</h1>${motif ? mountainMotif() : ''}</div>
        <section class="current-trip">
          <div class="current-trip-copy">
            <span class="eyebrow">Current trip</span>
            <h2>Tokyo · Kyoto</h2>
            <div class="meta-row"><span class="meta-item"><span class="meta-icon"></span>8 days</span><span class="meta-item"><span class="meta-icon clock"></span>12–20 Oct</span></div>
            <button class="button primary" type="button" data-route="day">Continue planning <span>→</span></button>
            ${clean ? '' : coastSketch()}
          </div>
          <div class="current-trip-art"><img class="art-image bus-art" src="assets/bus-fields.png" alt="A green bus travelling through yellow fields beside the coast"></div>
        </section>
        <div class="trip-list">
          ${tripRow('Jeju Island', '5 days', '2–6 Sep', 'assets/riverside-garden.png', 'jeju')}
          ${tripRow('Seoul', '4 days', '18–21 Aug', 'assets/kyoto-day-night.png', 'seoul')}
        </div>
        <button class="new-trip" type="button" data-route="plan"><span class="plus-circle">＋</span><span>Plan a new trip</span></button>
      </div>
    </section>
  </article>`;
}

function planFields(mobile) {
  return `<div class="field"><span class="field-label">Destination</span><div class="field-row"><span class="input-chip">Tokyo <b>×</b></span><span class="input-chip">Kyoto <b>×</b></span>${mobile ? '' : '<span class="input-chip add">＋ Add city</span>'}</div></div>
    <div class="field"><span class="field-label">Dates</span><div class="input-box">▣ &nbsp; 12–20 Oct</div></div>
    <div class="field"><span class="field-label">Pace of trip <small>ⓘ</small></span><div class="segmented" role="group" aria-label="Pace"><button type="button" data-pace="relaxed" aria-pressed="false">♧ &nbsp; Relaxed</button><button type="button" data-pace="balanced" aria-pressed="true">⚖ &nbsp; Balanced</button><button type="button" data-pace="full" aria-pressed="false">♢ &nbsp; Full</button></div></div>
    <div class="field"><span class="field-label">Interests <small>(choose up to 3)</small></span><div class="interest-row"><button class="interest" type="button" aria-pressed="true">♜ Food <span class="check-dot">✓</span></button><button class="interest" type="button" aria-pressed="true">◉ Art <span class="check-dot">✓</span></button><button class="interest" type="button" aria-pressed="true">▥ Neighbourhoods <span class="check-dot">✓</span></button></div></div>
    <div class="field"><span class="field-label">Budget <small>(optional)</small></span><div class="select-box"><span>▣ &nbsp; e.g. Moderate</span><span>⌄</span></div></div>
    <div class="trip-summary"><span>▣ &nbsp; 8 days</span><b>·</b><span>⌖ &nbsp; 2 cities</span><b>·</b><span>⚖ &nbsp; Balanced pace</span></div>
    <button class="button primary wide" type="button" data-route="discover">Build my first draft <span>→</span></button><p class="lock-note">♙ &nbsp; You can change everything later.</p>`;
}

function planScreen(mobile) {
  const intro = `<a class="back-link" href="#" data-route="trips-motif">← <span>Back to My Trips</span></a><h1>Plan a trip</h1><p class="lead">Tell us a few things, and we’ll build a personalized itinerary for you.</p>`;
  const illustration = `<div class="plan-illustration"><img class="art-image train-art" src="assets/train-lake.png" alt="A regional train crossing yellow flower fields beside a lake and mountains"></div>`;
  return `<article class="device ${mobile ? 'device-mobile' : 'device-desktop'}" aria-label="${mobile ? 'Mobile' : 'Desktop'} Plan a Trip prototype">
    ${header(mobile, false, 'trips')}
    <section class="screen mobile-screen">
      <div class="plan-layout">${mobile ? `<div class="plan-form">${intro}${illustration}${planFields(true)}</div>` : `<div class="plan-form">${intro}${planFields(false)}</div>${illustration}`}</div>
    </section>
  </article>`;
}

const dayRows = `
  <div class="timeline-row"><span class="timeline-time">09:00</span><span class="timeline-marker-wrap"><span class="timeline-marker">♧</span></span><div class="timeline-copy"><h3>Philosopher’s Path</h3><p class="description">Scenic canal-side walk lined with cherry trees, cafés, and small shrines.</p><div class="timeline-meta"><span>◷ 1 h 45 min</span></div></div></div>
  <div class="travel-row"><span></span><span class="travel-icon">♟</span><span>18 min walk</span></div>
  <div class="timeline-row"><span class="timeline-time">11:15</span><span class="timeline-marker-wrap"><span class="timeline-marker">鳥</span></span><div class="timeline-copy"><h3>Nanzen-ji</h3><p class="description">Historic temple complex with beautiful gardens and an impressive aqueduct.</p><div class="timeline-meta"><span>◷ 1 h 15 min</span><span class="open-status">Open until 17:00</span><a class="source-link" href="#">2 sources</a></div></div></div>
  <div class="travel-row"><span></span><span class="travel-icon">♟</span><span>10 min walk</span></div>
  <div class="timeline-row"><span class="timeline-time">12:45</span><span class="timeline-marker-wrap"><span class="timeline-marker meal">♜</span></span><div class="timeline-copy"><h3>Lunch nearby</h3><p class="description">Relax and refuel at a local spot.</p><div class="timeline-meta"><span>◷ 1 h 15 min (buffer)</span></div></div></div>
  <div class="travel-row"><span></span><span class="travel-icon">♟</span><span>15 min walk</span></div>
  <div class="timeline-row"><span class="timeline-time">14:30</span><span class="timeline-marker-wrap"><span class="timeline-marker">塔</span></span><div class="timeline-copy"><h3>Gion</h3><p class="description">Explore Kyoto’s famous geisha district, charming streets, and teahouses.</p><div class="timeline-meta"><span>◷ 2 h 30 min</span></div></div></div>`;

function proposal(mobile) {
  return `<aside class="proposal ${mobile ? '' : 'day-proposal'}"><span class="proposal-spark">✦</span><h3>Make this day lighter</h3><p>Preview 2 changes</p><div class="proposal-actions"><button class="button primary small" type="button" data-review>Review</button><button class="button secondary small" type="button" data-dismiss>Dismiss</button></div></aside>`;
}

function dayScreen(mobile) {
  return `<article class="device ${mobile ? 'device-mobile' : 'device-desktop'}" aria-label="${mobile ? 'Mobile' : 'Desktop'} Day Plan prototype">
    ${header(mobile, true, 'trips')}
    <section class="screen mobile-screen"><div class="screen-inner">
      <header class="day-header"><div><h1>Day 3 · Kyoto</h1><div class="day-status"><span>Wed, 16 Oct</span><span class="fits">This day fits</span></div></div><button class="ask-day" type="button"><span class="question-icon">?</span>Ask about this day</button></header>
      <div class="day-workspace"><section class="timeline-panel"><div class="day-tabs"><div class="day-tab"><strong>Day 1</strong><span>Tue, 14 Oct</span></div><div class="day-tab"><strong>Day 2</strong><span>Wed, 15 Oct</span></div><div class="day-tab is-active"><strong>Day 3</strong><span>Wed, 16 Oct</span></div><div class="day-tab"><strong>Day 4</strong><span>Thu, 17 Oct</span></div><div class="day-tab"><strong>Day 5</strong><span>Fri, 18 Oct</span></div></div><div class="timeline-body">${dayRows}${proposal(mobile)}<button class="add-activity" type="button"><span class="plus-circle">＋</span>Add activity</button></div></section><div class="day-illustration"><img class="art-image day-art" src="assets/kyoto-day-night.png" alt="Kyoto route from daytime streets to an evening district"></div></div>
      <button class="ask-day-mobile" type="button"><span class="question-icon">?</span>Ask about this day</button>
    </div></section>
  </article>`;
}

function shortlistItem(title, duration, description, image, position = 'center') {
  return `<div class="shortlist-item"><div class="shortlist-thumb"><img src="${image}" alt="" style="object-position:${position}"></div><div><h4>${title}</h4><p>◷ ${duration}<br>${description}</p></div><span class="drag-lines">≡</span></div>`;
}

function discoveryScreen(mobile) {
  const progress = Math.round((state.reviewed / 12) * 100);
  return `<article class="device ${mobile ? 'device-mobile' : 'device-desktop'}" aria-label="${mobile ? 'Mobile' : 'Desktop'} Choose Places prototype">
    ${header(mobile, true, 'discover')}
    <section class="screen mobile-screen"><div class="screen-inner">
      <header class="discover-heading"><div><h1>Choose places for Tokyo</h1><span class="progress-label"><b data-reviewed>${state.reviewed}</b> of 12 reviewed</span><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div></div>${mobile ? mountainMotif() : ''}</header>
      <div class="discover-layout"><section class="discovery-card"><div class="discovery-image"><img class="art-image garden-art" src="assets/riverside-garden.png" alt="A traveller walking beside a riverside garden pavilion"></div><div class="discovery-copy"><span class="eyebrow">Discovery</span><h2>Riverside garden</h2><p>Quiet paths, seasonal colour, easy morning visit.</p><div class="facts"><span class="fact">◷ Open until 17:00</span><span class="fact">◷ 1h 30m</span><span class="fact">¥500</span></div><a class="evidence" href="#">▣ &nbsp; 2 sources · checked today</a><div class="decision-actions"><button class="button secondary" type="button" data-decision="skip">Skip</button><button class="button secondary" type="button" data-decision="maybe">Maybe</button><button class="button primary" type="button" data-decision="keep">Keep ✓</button></div></div></section>
        <aside class="shortlist-card"><div class="shortlist-head"><h3>Your Tokyo shortlist <span class="kept-badge"><b data-kept>${state.kept}</b> kept</span></h3><p>We’ll build your itinerary around these places.</p></div><div class="shortlist-items">${shortlistItem('Senso-ji Temple','2h','Historic temple and bustling shopping street.','assets/riverside-garden.png','78% 50%')}${shortlistItem('Shibuya backstreets','1h 30m','Local cafés, small shops and street art.','assets/kyoto-day-night.png','45% 92%')}${shortlistItem('Shiba Park','1h','Open lawns and city views near Tokyo Tower.','assets/train-lake.png','82% 25%')}</div><button class="button primary wide" type="button" data-route="day">Build itinerary →</button><a class="decide-later" href="#">I’ll decide later</a><div class="shortlist-mobile"><strong><b data-kept>${state.kept}</b> kept</strong><div class="kept-thumbnails"><img src="assets/riverside-garden.png" alt=""><img src="assets/kyoto-day-night.png" alt=""><img src="assets/train-lake.png" alt=""></div><span class="chevron">›</span></div></aside>
      </div>
    </div></section>
  </article>`;
}

function screenMarkup(screen, mobile) {
  if (screen === 'trips-motif') return tripsScreen(mobile, true);
  if (screen === 'trips-clean') return tripsScreen(mobile, false);
  if (screen === 'plan') return planScreen(mobile);
  if (screen === 'day') return dayScreen(mobile);
  return discoveryScreen(mobile);
}

function render() {
  stage.className = `prototype-stage mode-${state.mode}`;
  stage.innerHTML = `${screenMarkup(state.screen, false)}${screenMarkup(state.screen, true)}`;
  bindScreenInteractions();
}

function chooseScreen(screen) {
  state.screen = screen;
  document.querySelectorAll('[data-screen]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.screen === screen)));
  render();
}

function bindScreenInteractions() {
  stage.querySelectorAll('[data-route]').forEach((trigger) => trigger.addEventListener('click', (event) => {
    event.preventDefault();
    chooseScreen(trigger.dataset.route);
  }));

  stage.querySelectorAll('.segmented').forEach((group) => {
    group.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
      group.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    }));
  });

  stage.querySelectorAll('.interest').forEach((button) => button.addEventListener('click', () => {
    const selected = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', String(!selected));
    const dot = button.querySelector('.check-dot');
    if (dot) dot.hidden = selected;
  }));

  stage.querySelectorAll('[data-review]').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
  stage.querySelectorAll('[data-dismiss]').forEach((button) => button.addEventListener('click', () => button.closest('.proposal').classList.add('is-hidden')));
  stage.querySelectorAll('[data-decision]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.decision === 'keep') state.kept = Math.min(12, state.kept + 1);
    state.reviewed = Math.min(12, state.reviewed + 1);
    render();
  }));
}

document.querySelectorAll('[data-screen]').forEach((button) => button.addEventListener('click', () => chooseScreen(button.dataset.screen)));
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  state.mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  render();
}));

render();
