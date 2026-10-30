// Survey summary tables shared by the staff screen and the admin panel.
import { html } from './html.js';

/** Mean of each rated item, overall and by 年代 / 性別. */
export function surveyMeansTable(sum) {
  const row = (r) => html`<tr><td>${r.label}</td><td class="num">${r.count}</td>${sum.questions.map((q) => html`<td class="num">${r.means[q.key] ?? '－'}</td>`)}</tr>`;
  return html`<div class="table-wrap"><table>
    <thead><tr><th>区分</th><th class="num">回答数</th>${sum.questions.map((q) => html`<th class="num">${q.label}（平均）</th>`)}</tr></thead>
    <tbody>${row(sum.overall)}${sum.byAge.map(row)}${sum.byGender.map(row)}</tbody></table></div>`;
}

/** How many answers gave each score, per rated item. */
export function surveyDistributionTable(sum) {
  const scale = [...sum.scale].sort((a, b) => b.code - a.code);
  return html`<div class="table-wrap"><table>
    <thead><tr><th>項目</th><th class="num">平均</th>${scale.map((x) => html`<th class="num">${x.code} ${x.label}</th>`)}</tr></thead>
    <tbody>${sum.questions.map((q) => html`<tr><td>${q.label}</td><td class="num">${q.mean ?? '－'}</td>${scale.map((x) => html`<td class="num">${q.distribution[x.code]}</td>`)}</tr>`)}</tbody></table></div>`;
}
