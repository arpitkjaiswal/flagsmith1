import advantage from './rehearsal.json';
import equalChance from './equal-chance.json';
import advantageCapture from './media/flagsmith-results.png?inline';
import equalChanceCapture from './media/equal-chance-results.png?inline';

const $ = (id) => document.getElementById(id);
const labels = { control: 'Standard desk', guided: 'Guided desk' };
const scenarios = [
    {
        title: 'Programmed advantage',
        report: advantage,
        capture: advantageCapture,
        filename: 'first-minute-rehearsal.json',
    },
    {
        title: 'Equal chances',
        report: equalChance,
        capture: equalChanceCapture,
        filename: 'first-minute-equal-chance.json',
    },
];
const percent = new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 });
const signed = new Intl.NumberFormat('en-GB', { signDisplay: 'exceptZero', maximumFractionDigits: 1 });
const rate = (desk) => desk.converted / desk.exposed;
const lift = (value) => signed.format(100 * value) + '%';
const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

// Drawing both intervals on one scale makes it possible to compare their size and relation to zero.
const inferences = scenarios.map(({ report }) => report.guided_inference);
const axisLow = Math.floor(4 * Math.min(0, ...inferences.map((i) => i.ci_low))) / 4;
const axisHigh = Math.ceil(4 * Math.max(0, ...inferences.map((i) => i.ci_high))) / 4;
const position = (value) => (100 * (value - axisLow)) / (axisHigh - axisLow || 1) + '%';

function rateRow(key, row) {
    const group = document.createElement('div');
    group.className = 'rate-row ' + key;
    group.innerHTML = '<strong></strong><span></span><div class="rate-track" aria-hidden="true"><span></span></div>';
    group.firstElementChild.textContent = labels[key];
    group.children[1].textContent = row.converted + ' of ' + row.exposed + ' · ' + percent.format(rate(row));
    group.querySelector('.rate-track span').style.width = 100 * rate(row) + '%';
    return group;
}

function selectScenario(scenario) {
    const { report, capture, filename } = scenario;
    const { guided, control } = report.variants;
    const total = guided.exposed + control.exposed;
    const rates = report.simulated_success_rates;
    const sameRate = rates.control === rates.guided;
    for (const button of $('scenarios').children) {
        button.setAttribute('aria-pressed', String(button.dataset.file === filename));
    }
    const rule = sameRate
        ? `Both desks used the same ${percent.format(rates.control)} success rule.`
        : `The generator set a ${percent.format(rates.control)} success chance for standard and ${percent.format(rates.guided)} for guided.`;
    $('replay-source').textContent = `Flagsmith measured ${total} synthetic attempts. ${rule}`;
    const split = report.configured_split;
    $('allocation-description').textContent =
        `The ${report.flag} flag allocated ${split.control}% of traffic to standard and ${split.guided}% to guided. Each identity kept its assigned desk.`;
    $('split-standard').style.width = (100 * control.exposed) / total + '%';
    $('assigned-control').textContent = control.exposed + ' standard';
    $('assigned-guided').textContent = guided.exposed + ' guided';
    $('result-bars').replaceChildren(rateRow('control', control), rateRow('guided', guided));

    const inference = report.guided_inference;
    $('difference').textContent = signed.format(100 * (rate(guided) - rate(control))) + ' pp';
    $('win-chance').textContent =
        inference.chance_to_win > 0.999 && inference.chance_to_win < 1
            ? '>99.9%'
            : percent.format(inference.chance_to_win);
    const interval = `${lift(inference.ci_low)} to ${lift(inference.ci_high)}`;
    const allocation = report.allocation_check;
    $('stat-detail').textContent =
        `Relative lift ${lift(inference.lift)} (95% credible interval ${interval}). ${allocation.method}, p = ${allocation.p_value.toFixed(3)}.`;
    if (report.rollout) {
        const { desk, percentage, new_identities_verified: checks } = report.rollout;
        $('rollout-checks').textContent = checks + ' / ' + checks;
        $('rollout-label').textContent = 'SDK checks passed after rollout';
        $('rollout-description').textContent =
            `After the rehearsal closed, the same flag served the ${labels[desk].toLowerCase()} to ${percentage}% of users. All ${checks} fresh test identities received that desk outside the experiment.`;
    } else {
        $('rollout-checks').textContent = report.configured_split.control + ' / ' + report.configured_split.guided;
        $('rollout-label').textContent = 'Traffic split verified in Flagsmith';
        $('rollout-description').textContent =
            (report.decision.supported_desk
                ? 'A desk crossed the decision threshold despite equal input chances. This is a false positive in the simulation.'
                : 'The evidence supports neither desk. The interval includes zero.') +
            ' The equal-chance check left enrolment running with the original split.';
    }
    $('replay-date').dateTime = report.as_of;
    $('replay-date').textContent = 'Captured ' + date.format(new Date(report.as_of));
    $('download-results').download = filename;
    $('download-results').href =
        'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2) + '\n');
    $('dashboard-capture').src = capture;
    $('dashboard-capture').alt =
        `Flagsmith dashboard for the ${scenario.title.toLowerCase()} rehearsal, showing enrolment, conversion rates and the credible interval.`;
}

for (const scenario of scenarios) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.file = scenario.filename;
    button.innerHTML =
        '<strong></strong><span class="interval-track" aria-hidden="true"><i></i><b></b></span><span class="interval-label"></span>';
    button.querySelector('strong').textContent = scenario.title;
    const interval = scenario.report.guided_inference;
    const track = button.querySelector('.interval-track');
    track.style.setProperty('--zero', position(0));
    track.style.setProperty('--low', position(interval.ci_low));
    track.style.setProperty('--high', position(interval.ci_high));
    track.style.setProperty('--lift', position(interval.lift));
    button.querySelector('.interval-label').textContent = lift(interval.ci_low) + ' to ' + lift(interval.ci_high);
    button.onclick = () => selectScenario(scenario);
    $('scenarios').append(button);
}
selectScenario(scenarios[0]);

const liveDashboard = import.meta.env.MODE !== 'practice' && import.meta.env.VITE_FLAGSMITH_DASHBOARD_URL;
if (liveDashboard) {
    $('participant-dashboard').href = liveDashboard;
    $('participant-dashboard').hidden = false;
}

const steps = document.querySelectorAll('.replay-stages button');
function selectStage(stage) {
    for (const step of steps) {
        const panel = step.getAttribute('aria-controls');
        step.setAttribute('aria-pressed', String(panel === stage));
        $(panel).hidden = panel !== stage;
    }
}
for (const step of steps) step.onclick = () => selectStage(step.getAttribute('aria-controls'));
export function openResults() {
    selectStage('measurement');
    $('notes').showModal();
}
