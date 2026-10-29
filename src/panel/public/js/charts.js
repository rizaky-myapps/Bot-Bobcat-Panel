// Graphiques de la page Statistiques (Chart.js), recolorés au changement de thème.
(function () {
  var dataEl = document.getElementById('stats-data');
  if (!dataEl || !window.Chart) return;
  var data = JSON.parse(dataEl.textContent);
  var charts = [];

  function tokens() {
    var s = getComputedStyle(document.documentElement);
    var v = function (name) {
      return s.getPropertyValue(name).trim();
    };
    return { series: v('--series-1'), grid: v('--grid'), axis: v('--axis'), text: v('--text-secondary'), muted: v('--text-muted'), surface: v('--surface') };
  }

  function hours(value) {
    var h = Math.floor(value);
    var m = Math.round((value - h) * 60);
    return h + 'h' + String(m).padStart(2, '0');
  }

  function build() {
    charts.forEach(function (c) {
      c.destroy();
    });
    charts = [];
    var t = tokens();
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = t.muted;

    var common = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: t.surface,
          titleColor: t.text,
          bodyColor: t.text,
          borderColor: t.grid,
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: function (ctx) {
              return hours(ctx.parsed.y !== undefined && ctx.chart.options.indexAxis !== 'y' ? ctx.parsed.y : ctx.parsed.x);
            },
          },
        },
      },
    };
    var bar = { backgroundColor: t.series, hoverBackgroundColor: t.series, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 };

    var weekly = document.getElementById('weeklyChart');
    if (weekly) {
      charts.push(
        new Chart(weekly, {
          type: 'bar',
          data: { labels: data.weekly.map((w) => w.label), datasets: [Object.assign({ data: data.weekly.map((w) => w.hours) }, bar)] },
          options: Object.assign({}, common, {
            scales: {
              x: { grid: { display: false }, border: { color: t.axis } },
              y: { beginAtZero: true, grid: { color: t.grid }, border: { display: false }, ticks: { callback: (v) => v + ' h', precision: 0 } },
            },
          }),
        }),
      );
    }

    var places = document.getElementById('placesChart');
    if (places) {
      charts.push(
        new Chart(places, {
          type: 'bar',
          data: { labels: data.places.map((p) => p.label), datasets: [Object.assign({ data: data.places.map((p) => p.hours) }, bar)] },
          options: Object.assign({}, common, {
            indexAxis: 'y',
            scales: {
              x: { beginAtZero: true, grid: { color: t.grid }, border: { display: false }, ticks: { callback: (v) => v + ' h', precision: 0 } },
              y: { grid: { display: false }, border: { color: t.axis }, ticks: { color: t.text } },
            },
          }),
        }),
      );
    }
  }

  build();
  document.addEventListener('themechange', build);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', build);
})();
