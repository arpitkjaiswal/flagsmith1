import { openResults } from './experiment-replay.js';
import { resetRecovery } from './recovery.js';
import { claimAnswer, clearPendingAnswer, updateRecord } from './attempt-store.js';
import { createEventDelivery } from './event-delivery.js';
import flagsmith from '@flagsmith/flagsmith';

const $ = (id) => document.getElementById(id);
const evidence = {
    'Release log': [
        ['13:58', 'Release 8.3 healthy. Checkout p95 is 220 ms.'],
        ['14:04', 'Release 8.4 rolled out. Checkout database pool limit changed from 40 to 4 connections per worker.'],
        ['14:06', 'No changes to routing, request limits or the payment provider.'],
    ],
    Metrics: [
        ['Demand', 'Checkout traffic holds at 97–101 requests per second throughout the release.'],
        ['Database', 'Query execution p95 holds at 17 ms. All four pool connections are busy.'],
        ['Queue', 'Connection acquisition p95 rises from 8 ms to 2.61 s.'],
    ],
    Traces: [
        ['14:02', 'POST /checkout · 208 ms total · 7 ms waiting for a connection.'],
        ['14:07', 'POST /checkout · 2,866 ms total · 2,650 ms waiting for a connection.'],
        ['Payment', 'Provider authorisation takes 104 ms before the release and 108 ms after.'],
    ],
};
const answers = [
    ['provider', 'The external payment provider slowed down.'],
    ['pool', 'The release reduced the database connection pool.'],
    ['traffic', 'An unexpected traffic spike overwhelmed checkout.'],
];
const flagName = 'triage_guide';
const identityKey = 'first-minute.participant.v1';
const experimentKey = import.meta.env.MODE === 'practice' ? '' : import.meta.env.VITE_FLAGSMITH_ENVIRONMENT_ID;
const attemptKey = 'first-minute.first-attempt.v1.' + (experimentKey || 'practice');
const unconfiguredPractice = 'first-minute.unconfigured-practice.v1';
const root = (import.meta.env.VITE_FLAGSMITH_ORIGIN || location.origin).replace(/\/+$/, '');
const flagLookupTimeoutMs = 4000;
let connected = false;
let active;
let interval;
let lastLayout = 'control';
let saved = null;
let participant;
let journalKey;
let syncEvents;
let displayed;

let starting = false;
const updates = experimentKey && typeof BroadcastChannel === 'function' ? new BroadcastChannel(attemptKey) : null;

function drawChart() {
    const canvas = $('chart');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#36504a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
        ctx.moveTo((width * i) / 8, 0);
        ctx.lineTo((width * i) / 8, height);
    }
    for (let i = 0; i <= 4; i++) {
        ctx.moveTo(0, (i * height) / 4);
        ctx.lineTo(width, (i * height) / 4);
    }
    ctx.stroke();
    const samples = [
        9, 10, 9, 12, 10, 12, 9, 10, 13, 10, 12, 10, 11, 10, 14, 11, 12, 11, 12, 20, 17, 34, 25, 48, 39, 72, 44, 61, 52,
        86, 63, 78, 58, 74, 69, 82, 67, 78, 75,
    ];
    ctx.beginPath();
    samples.forEach((s, i) => {
        const x = (width * i) / (samples.length - 1);
        const y = height * (1 - s / 100);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#d1f367';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, '#d1f36755');
    fill.addColorStop(1, '#d1f36704');
    ctx.fillStyle = fill;
    ctx.fill();
}
new ResizeObserver(drawChart).observe($('chart'));

function selectTab(name) {
    for (const button of $('tabs').children) button.setAttribute('aria-pressed', String(button.textContent === name));
    $('signals').replaceChildren(
        ...evidence[name].map(([label, message]) => {
            const row = document.createElement('div');
            row.className = 'reading';
            const time = document.createElement('time');
            time.textContent = label;
            row.append(time, document.createTextNode(message));
            return row;
        }),
    );
}
for (const name of Object.keys(evidence)) {
    const button = document.createElement('button');
    button.textContent = name;
    button.onclick = () => selectTab(name);
    $('tabs').append(button);
}
for (const [value, answer] of answers) {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    Object.assign(input, { type: 'radio', name: 'cause', value, required: true });
    label.append(input, document.createTextNode(' ' + answer));
    $('choices').append(label);
}
function refreshClock() {
    if (!active) return;
    const remaining = Math.max(0, Math.ceil((active.deadline - Date.now()) / 1000));
    $('clock').textContent = remaining + 's';
    if (remaining === 0) finish('expired');
}

function openDesk(held) {
    lastLayout = active.layout;
    $('preflight').hidden = true;
    $('desk').hidden = false;
    $('result').hidden = true;
    displayed = null;
    $('save-error').hidden = true;
    $('form').hidden = false;
    $('guide').hidden = active.layout !== 'guided';
    $('form').reset();
    selectTab('Release log');
    $('start').disabled = true;
    $('start').textContent = 'Drill in progress';
    $('mode').textContent = active.measured ? 'Experiment · first attempt' : 'Practice · excluded from experiment';
    $('desk').focus({ preventScroll: true });
    $('desk').scrollIntoView({ block: 'start' });
    if (held) {
        active = null;
        void saveAnswer(held);
        return;
    }
    refreshClock();
    if (active) interval = setInterval(refreshClock, 200);
}

async function claimFirstAttempt() {
    const flag = connected ? flagsmith.getAllFlags()[flagName] : null;
    const layout = flag?.enabled && flag.value === 'guided' ? 'guided' : 'control';
    saved = await updateRecord(
        attemptKey,
        (previous, practised) => {
            if (previous) return previous;
            const measured = !practised && Boolean(flag?.enabled && flag.experiment?.inExperiment);
            return {
                layout,
                measured,
                deadline: Date.now() + 60000,
                ...(measured && { identifier: participant, variant: flag.variant, experimentId: flag.experiment.id }),
            };
        },
        { relatedKey: unconfiguredPractice },
    );
    // The earliest release stored completion without a verdict.
    if (saved.done && !saved.finishedAt) return { layout: saved.layout, measured: false, deadline: Date.now() + 60000 };
    return saved;
}

function showStorageRetry() {
    $('mode').textContent = 'Browser storage is unavailable. Reload to open your first attempt.';
    $('start').textContent = 'Reload briefing';
    $('start').disabled = false;
    $('start').onclick = () => location.reload();
}

async function rememberPractice() {
    try {
        localStorage.setItem(unconfiguredPractice, '1');
    } catch {
        // IndexedDB can remember practice when localStorage is blocked.
    }
    try {
        await updateRecord(unconfiguredPractice, () => true);
    } catch {
        // A standalone file can also be used with both storage mechanisms disabled.
    }
}

$('method').hidden = Boolean(experimentKey);
$('method').onclick = async () => {
    if (!experimentKey) await rememberPractice();
    openResults();
};
$('show-experiment').onclick = openResults;

async function begin(forcePractice = false) {
    if (active || starting) return;
    starting = true;
    try {
        if (!experimentKey && !forcePractice) await rememberPractice();
        let round;
        if (experimentKey && !forcePractice) {
            try {
                round = await claimFirstAttempt();
            } catch {
                showStorageRetry();
                return;
            }
        } else {
            round = { layout: lastLayout, measured: false, deadline: Date.now() + 60000 };
        }
        if (round.done) {
            displayResult(round);
            return;
        }
        active = round;
        openDesk();
        if (round.measured) syncEvents();
    } finally {
        starting = false;
    }
}

function showDelivery(record) {
    if (!displayed || displayed.measured !== record.measured || displayed.deadline !== record.deadline) return;
    const desk = displayed.layout === 'guided' ? 'guided' : 'standard';
    $('receipt-events').hidden = !displayed.measured;
    $('receipt-context').textContent = displayed.measured
        ? `The triage_guide flag assigned the ${desk} desk on your first attempt.`
        : `You played the ${desk} desk in practice. This round sends no participant events.`;
    if (!displayed.measured) return;
    const delivery = record.delivery || {};
    const status = (name) =>
        delivery[name] ? 'Accepted by Flagsmith' : delivery.expired ? 'Delivery window closed' : 'Awaiting receipt';
    $('receipt-exposure').textContent = status('$flag_exposure');
    $('receipt-conversion').textContent =
        displayed.answer === 'pool'
            ? status('drill_resolved')
            : displayed.answer === 'expired'
              ? 'No event · time expired'
              : 'No event · incorrect first answer';
    let message = '';
    if (record.delivery?.expired) {
        message = 'Flagsmith’s event delivery window has closed. Your drill result is saved on this device.';
    } else if (record.delivery?.failed) {
        message = 'Event delivery unconfirmed. Your result is saved and will be retried.';
    }
    $('delivery-status').textContent = message;
    $('delivery-status').hidden = !message;
}

function updateHandoff() {
    if (!displayed) return;
    const submitted = answers.find(([value]) => value === displayed.answer);
    const lines = [
        'First Minute | Simulated checkout incident',
        '',
        'First diagnosis: ' + (submitted ? submitted[1] : 'Time expired before submission.'),
        $('outcome').textContent,
        '',
        'Release 8.4 at 14:04 UTC reduced the connection pool from 40 to 4 per worker.',
        'Traffic stayed at 97–101 requests/s. Query execution p95 held at 17 ms.',
        'The 14:07 checkout spent 2,650 of 2,866 ms waiting for a connection.',
        '',
        'Recovery model: apply ' + $('connections').value + ' connections per worker at 30 s.',
        $('capacity-outcome').textContent,
        'Assumptions: 100 arrivals/s, a 50 ms connection hold time and 600 requests waiting at the change.',
    ];
    $('handoff').href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(lines.join('\n') + '\n');
}
$('connections').addEventListener('input', updateHandoff);

function displayResult(attempt) {
    clearInterval(interval);
    active = null;
    displayed = attempt;
    $('delivery-status').hidden = true;
    $('round-receipt').open = false;
    showDelivery(attempt);
    lastLayout = attempt.layout;
    const timedOut = attempt.answer === 'expired';
    const correct = attempt.answer === 'pool';
    const seconds = Math.min(60, Math.max(0, Math.ceil((attempt.finishedAt - attempt.deadline + 60000) / 1000)));
    $('preflight').hidden = true;
    $('desk').hidden = true;
    $('result').hidden = false;
    const heading = timedOut ? 'Time expired.' : correct ? 'Root cause found.' : 'Look at the connection queue.';
    $('verdict').textContent = heading;
    const feedback = {
        traffic:
            'Traffic held at 97–101 requests per second. The queue grew because release 8.4 cut each worker’s connection pool from 40 to 4.',
        provider:
            'Payment authorisation increased by just 4 ms. The slow checkout spent 2,650 ms waiting for a database connection after release 8.4 cut the pool from 40 to 4.',
    };
    $('diagnosis-feedback').textContent =
        feedback[attempt.answer] ??
        'Release 8.4 cut the connection pool from 40 to 4. Requests waited 2.65 seconds for a connection while queries and payment authorisations stayed fast.';
    resetRecovery();
    $('outcome').textContent =
        seconds + 's elapsed · ' + (attempt.layout === 'guided' ? 'Guided desk' : 'Standard desk');
    updateHandoff();
    $('method').hidden = false;
    $('replay').onclick = () => begin(true);
    $('switch-layout').onclick = () => {
        lastLayout = attempt.layout === 'guided' ? 'control' : 'guided';
        begin(true);
    };
    $('start').disabled = false;
    $('start').textContent = 'Practise again →';
    $('start').onclick = () => begin(true);
    $('mode').textContent = 'Debrief ready';
    $('result').focus();
}

async function saveAnswer(submission) {
    $('retry-answer').disabled = true;
    try {
        const first = await claimAnswer(journalKey, submission);
        saved = await updateRecord(
            attemptKey,
            (current, journal) => {
                if (current?.done) return current;
                const answer = journal?.deadline === first.deadline ? journal : first;
                return { ...(current ?? { ...saved, measured: false }), ...answer, done: true };
            },
            { relatedKey: journalKey },
        );
    } catch {
        $('form').hidden = true;
        $('save-error').hidden = false;
        $('retry-answer').disabled = false;
        $('retry-answer').onclick = () => saveAnswer(submission);
        $('retry-answer').focus();
        return;
    }
    clearPendingAnswer(journalKey);
    updates?.postMessage(saved);
    displayResult(saved);
    if (saved.measured) syncEvents();
}

function finish(answer) {
    if (!active) return;
    const finishedAt = Date.now();
    const isFirstAttempt = active === saved;
    const outcome = { ...active, done: true, finishedAt, answer: finishedAt >= active.deadline ? 'expired' : answer };
    clearInterval(interval);
    active = null;
    if (isFirstAttempt) {
        const submission = { deadline: outcome.deadline, finishedAt, answer: outcome.answer };
        void saveAnswer(submission);
    } else displayResult(outcome);
}
if (updates)
    updates.onmessage = ({ data }) => {
        if (active && active === saved && data.done && data.finishedAt && data.deadline === active.deadline) {
            saved = data;
            displayResult(data);
        }
    };
$('form').onsubmit = (event) => {
    event.preventDefault();
    void finish(new FormData(event.currentTarget).get('cause'));
};

async function connectFlagsmith(participant) {
    await flagsmith.init({
        environmentID: experimentKey,
        identity: participant,
        api: root + '/api/v1/',
        fetch: (url, options) =>
            fetch(url, { ...options, signal: options?.signal ?? AbortSignal.timeout(flagLookupTimeoutMs) }),
    });
    return Boolean(flagsmith.getAllFlags()[flagName]);
}

async function initialise() {
    $('start').disabled = true;
    let held;
    if (experimentKey) {
        try {
            participant = await updateRecord(identityKey, (previous) => previous || crypto.randomUUID(), {
                parseLegacy: (value) => value,
            });
            journalKey = attemptKey + '.answer.' + participant;
            syncEvents = createEventDelivery({
                key: attemptKey,
                environmentID: experimentKey,
                root,
                feature: flagName,
                identifier: participant,
                onChange: showDelivery,
            });
            saved = await updateRecord(
                attemptKey,
                (previous, journal) => {
                    if (journal && previous?.deadline === journal.deadline) held = journal;
                    return previous;
                },
                { relatedKey: journalKey },
            );
        } catch {
            showStorageRetry();
            return;
        }
        if (!saved) {
            try {
                connected = await connectFlagsmith(participant);
            } catch (error) {
                console.warn('Experiment unavailable.', error);
            }
        }
    }
    $('start').onclick = () => begin(Boolean(saved));
    $('start').disabled = false;
    if (saved?.measured) syncEvents();
    if (saved && !saved.done && (saved.measured || held)) {
        active = saved;
        lastLayout = saved.layout;
        openDesk(held);
        return;
    }
    if (saved?.done && saved.finishedAt) {
        displayResult(saved);
        return;
    }
    if (saved) {
        lastLayout = saved.layout;
        $('start').textContent = 'Enter practice →';
    }
    $('mode').textContent = saved
        ? 'Previous attempt · practice available'
        : connected
          ? 'Connected to Flagsmith'
          : 'Practice mode · experiment offline';
}
void initialise();
