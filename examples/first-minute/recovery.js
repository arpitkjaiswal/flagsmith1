const slider = document.getElementById('connections');
const canvas = document.getElementById('queue-chart');
const demand = 100;
const requestsPerConnection = 20;
const originalPool = 4;
const changeAt = 30;
const endAt = 60;
const growthBeforeChange = demand - originalPool * requestsPerConnection;
const waitingAtChange = growthBeforeChange * changeAt;
const baseline = growthBeforeChange * endAt;
const numbers = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

function render() {
    const pool = Number(slider.value);
    const spare = pool * requestsPerConnection - demand;
    const remaining = Math.max(0, waitingAtChange - spare * (endAt - changeAt));
    const drainSeconds = spare > 0 ? waitingAtChange / spare : Infinity;
    const result =
        spare > 0
            ? `The queue clears in ${numbers.format(drainSeconds)} s after the change.`
            : spare === 0
              ? 'Capacity matches arrivals. The existing queue stays put.'
              : `The queue grows by ${-spare} requests each second.`;
    document.getElementById('pool-value').value = String(pool);
    document.getElementById('capacity-outcome').textContent = `${numbers.format(remaining)} waiting at 60 s. ${result}`;
    canvas.setAttribute(
        'aria-label',
        `With four connections, ${numbers.format(baseline)} checkouts wait at 60 seconds. With ${pool} connections, ${numbers.format(remaining)} wait.`,
    );

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    const top = 16,
        bottom = height - 24,
        left = 42,
        right = width - 12;
    const highest = Math.ceil(Math.max(baseline, remaining) / 600) * 600;
    const x = (second) => left + ((right - left) * second) / endAt;
    const y = (count) => bottom - ((bottom - top) * count) / highest;
    ctx.font = '11px ui-monospace, monospace';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    for (const value of [0, highest / 2, highest]) {
        ctx.strokeStyle = '#39554d';
        ctx.beginPath();
        ctx.moveTo(left, y(value));
        ctx.lineTo(right, y(value));
        ctx.stroke();
        ctx.fillStyle = '#c7d6cb';
        ctx.fillText(numbers.format(value), left - 6, y(value) + 4);
    }
    ctx.strokeStyle = '#859b8e';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(x(changeAt), top);
    ctx.lineTo(x(changeAt), bottom);
    ctx.stroke();
    ctx.fillText('60 s', right, height - 5);
    ctx.textAlign = 'left';
    ctx.fillText('0 s', left, height - 5);
    ctx.textAlign = 'center';
    ctx.fillText('30 s · apply', x(changeAt), height - 5);

    ctx.setLineDash([]);
    ctx.strokeStyle = '#d1f367';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x(0), y(0));
    ctx.lineTo(x(changeAt), y(waitingAtChange));
    if (changeAt + drainSeconds < endAt) ctx.lineTo(x(changeAt + drainSeconds), y(0));
    ctx.lineTo(right, y(remaining));
    ctx.stroke();
    ctx.strokeStyle = '#e0e8e1';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x(0), y(0));
    ctx.lineTo(right, y(baseline));
    ctx.stroke();
}

slider.addEventListener('input', render);
new ResizeObserver(render).observe(canvas);

export function resetRecovery() {
    slider.value = String(originalPool);
    render();
}
