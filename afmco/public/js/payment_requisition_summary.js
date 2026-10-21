// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.provide("afmco.pr_summary");

(() => {
	const esc = (value) => frappe.utils.escape_html(String(value ?? ""));
	const isBlank = (value) => value === null || value === undefined || ["", "None", "null"].includes(String(value).trim());
	const amount = (value) => format_number(flt(value), null, 2);
	const riyal = () => `<span class="prc-riyal" role="img" aria-label="${esc(__("Riyals"))}">\u20C1</span>`;
	const money = (value) => `<span class="prc-money prc-num">${riyal()}${amount(value)}</span>`;
	const day = (value) => (isBlank(value) ? "" : frappe.datetime.str_to_user(value, false, true));
	const stamp = (value) => (isBlank(value) ? "" : frappe.datetime.str_to_user(value));
	const ltr = (value, cls = "") => `<span class="prc-ltr ${cls}">${esc(value)}</span>`;
	const mixed = (value) => (isBlank(value) ? "" : `<bdi dir="auto">${esc(value).replace(/ - (?=[^-]*$)/, " -&nbsp;")}</bdi>`);
	const parseNum = (value) => {
		const text = String(value).replace(/[,\s]/g, "");
		return /^-?\d+(?:\.\d+)?$/.test(text) ? parseFloat(text) : null;
	};
	const clamp = (html, lines = 2) =>
		`<div class="prc-clamp prc-clamp--${lines}">${html}</div><button type="button" class="prc-more" hidden data-more>${esc(__("Show all"))}</button>`;

	const SADAD = ["SADAD Payment", "Work Permit Fee Payment", "Passport Fee Payment"];
	const BANK_LOCKED = ["Document Upload", "Waiting", "Paid", "Cancelled"];
	const BANK_ENTRY = ["Waiting Bank Entry", "First Approval for Bank"];
	const BANK_DATE_STATES = [...BANK_ENTRY, "Document Upload", "Waiting", "Paid"];
	const JE_STATES = ["Document Upload", "Paid"];
	const STATE_TONE = {
		"Financial Controller": "blue",
		"Waiting P.M Approval": "amber",
		"Waiting Manager Approval": "amber",
		"Waiting Bank Entry": "amber",
		"First Approval for Bank": "amber",
		"Document Upload": "accent",
		Waiting: "amber",
		Paid: "green",
		Rejected: "red",
	};
	const BANKS = {
		10: "Saudi National Bank",
		80: "Al Rajhi Bank",
		"05": "Alinma Bank",
		20: "Riyad Bank",
		15: "Bank Albilad",
		30: "Arab National Bank",
		45: "Saudi Awwal Bank",
		55: "Banque Saudi Fransi",
		60: "Bank AlJazira",
		65: "Saudi Investment Bank",
	};
	const NUM_ONLY = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;
	const AMOUNT_KEY = /amount|fee|total|price|salary|مبلغ|رسوم|المبلغ|الإجمالي|قيمة|المجموع|راتب/i;
	const TOTAL_KEY = /^total|total amount|الإجمالي|المجموع|الصافي|net/i;
	const CURRENCY_SUFFIX = /\s*(SAR|ريال|ر\.س)$/;
	const PAGE = 20;
	const RX = {
		sep: /^[-=_~*.•·]{4,}$/,
		bullet: /^(?:(\d{1,3})\s*[.)\-–]|[-*•▪●])\s+(.+)$/,
		id: /^\d{8,20}$/,
		nameid: /^(.*\p{L}.*?)\s+(\d{8,15})$/u,
		formula: /^[\d\s.,+\-*×x()/=]+$/,
		split: /\s+[-–|]\s+|\s*\t\s*|\s+\|\s*|\s*\|\s+/,
	};

	function jeShown(frm) {
		return JE_STATES.includes(frm.doc.workflow_state) || paymentDates(frm).length > 0;
	}

	function paymentDates(frm) {
		return (frm.doc.__onload || {}).payment_dates || [];
	}

	function kvSplit(text) {
		const match = text.match(/^([^:|：]{1,48}?)\s*[:|：](?!\/\/)\s*(.*)$/);
		if (!match) return null;
		const k = match[1].trim();
		const v = match[2].trim();
		if (!/\p{L}/u.test(k) || k.split(/\s+/).length > 6 || /^https?$/i.test(k)) return null;
		return { k, v };
	}

	function classify(line) {
		if (!line) return { t: "blank" };
		if (RX.sep.test(line)) return { t: "sep" };
		let body = line;
		let bullet = null;
		const b = line.match(RX.bullet);
		if (b) {
			bullet = b[1] || "•";
			body = b[2].trim();
		}
		if ((body.match(/\|/g) || []).length >= 2 || /\t/.test(body)) return { t: "row", text: body };
		if (RX.formula.test(body) && body.includes("=") && /\d/.test(body)) return { t: "formula", text: body };
		const kv = kvSplit(body);
		if (kv) return kv.v ? { t: "kv", k: kv.k, v: kv.v, bullet } : { t: "head", text: kv.k };
		if (!bullet && RX.id.test(body)) return { t: "id", v: body };
		const ni = body.match(RX.nameid);
		if (ni && ni[1].trim().split(/\s+/).length >= 2) {
			return { t: "nameid", name: ni[1].trim().replace(/\s{2,}/g, " "), id: ni[2], bullet };
		}
		if (bullet) return { t: "item", n: bullet, text: body, raw: line };
		return { t: "text", text: body };
	}

	const splitCols = (text) =>
		text
			.split(RX.split)
			.map((s) => s.trim())
			.filter(Boolean);

	function colMeta(rows, ncol) {
		const meta = [];
		for (let c = 0; c < ncol; c++) {
			const vals = rows.map((r) => r[c]).filter((v) => !isBlank(v));
			meta.push({
				num: vals.length > 0 && vals.every((v) => NUM_ONLY.test(String(v).replace(CURRENCY_SUFFIX, ""))),
				id: vals.length > 0 && vals.every((v) => /^\d{8,20}$/.test(v)),
			});
		}
		return meta;
	}

	function tryDashTable(lines, numbered, allowHeader) {
		if (lines.length < 2) return null;
		let parts = lines.map((l) => splitCols(l.text));
		let hdr = null;
		if (
			allowHeader &&
			parts.length >= 3 &&
			parts[0].length >= 2 &&
			parts.slice(1).every((p) => p.length === parts[0].length) &&
			parts[0].every((v) => parseNum(v) === null)
		) {
			hdr = parts[0];
			parts = parts.slice(1);
			lines = lines.slice(1);
		}
		const n = parts[0].length;
		if (n < 2 || !parts.every((p) => p.length === n)) {
			if (hdr) return null;
			const tail = lines.map((l) => l.text.match(/^(.*?)[\s:\-–]+(-?[\d,]+(?:\.\d+)?)\s*(SAR|ريال|ر\.س)?$/));
			if (tail.filter(Boolean).length >= Math.max(2, Math.ceil(lines.length * 0.7))) {
				const rows = lines.map((l, i) => (tail[i] ? [tail[i][1].trim(), tail[i][2]] : [l.text, ""]));
				return {
					t: "table",
					cols: [__("Statement"), __("Amount")],
					rows,
					numbered,
					meta: [{ num: false }, { num: true }],
					amountCols: [1],
				};
			}
			return null;
		}
		const rows = parts.map((p) => p.map((v) => v.replace(CURRENCY_SUFFIX, "")));
		const meta = colMeta(rows, n);
		if (hdr) {
			const numCols = meta.map((m, i) => (m.num && !m.id ? i : -1)).filter((i) => i >= 0);
			const named = numCols.filter((i) => AMOUNT_KEY.test(hdr[i]));
			return { t: "table", cols: hdr, rows, numbered: true, meta, amountCols: named.length ? named : numCols.slice(0, 1) };
		}
		if (!meta.some((m) => m.num)) return null;
		let amountAt = -1;
		const cols = meta.map((m, i) => {
			if (m.num && !m.id && amountAt < 0) {
				amountAt = i;
				return __("Amount");
			}
			if (i === 0) return __("Statement");
			return m.id ? __("Number") : __("Detail");
		});
		return { t: "table", cols, rows, numbered, meta, amountCols: [amountAt] };
	}

	function parseRemark(raw) {
		const lines = String(raw || "")
			.replace(/\r/g, "")
			.split("\n")
			.map((l) => l.trim());
		while (lines.length && !lines[0]) lines.shift();
		while (lines.length && !lines[lines.length - 1]) lines.pop();
		const runs = [];
		for (const c of lines.map(classify)) {
			const last = runs[runs.length - 1];
			if (last && last.t === c.t && !["sep", "blank", "head"].includes(c.t)) last.items.push(c);
			else runs.push({ t: c.t, items: [c] });
		}
		let blocks = [];
		runs.forEach((run, i) => {
			const it = run.items;
			if (run.t === "blank") return blocks.push({ t: "gap" });
			if (run.t === "sep") return blocks.push({ t: "sep" });
			if (run.t === "head") return blocks.push({ t: "head", text: it[0].text });
			if (run.t === "formula") return it.forEach((x) => blocks.push({ t: "formula", text: x.text }));
			if (run.t === "kv") {
				return blocks.push(it.length === 1 ? { t: "para", kvLine: it[0] } : { t: "kv", rows: it.map((x) => [x.k, x.v]) });
			}
			if (run.t === "id") {
				return blocks.push(it.length >= 2 ? { t: "ids", ids: it.map((x) => x.v) } : { t: "para", text: it[0].v });
			}
			if (run.t === "nameid") {
				return blocks.push(
					it.length >= 2
						? {
								t: "table",
								cols: [__("Name"), __("ID Number")],
								rows: it.map((x) => [x.name, x.id]),
								numbered: true,
								meta: [{}, { id: true }],
								amountCols: [],
							}
						: { t: "para", text: `${it[0].name}  ${it[0].id}` },
				);
			}
			if (run.t === "row") {
				return blocks.push(tryDashTable(it, false, true) || { t: "para", text: it.map((x) => x.text).join("\n") });
			}
			if (run.t === "item") {
				const table = tryDashTable(it, true);
				if (table) return blocks.push(table);
				return blocks.push(
					it.length >= 2 ? { t: "list", ordered: /\d/.test(it[0].n), items: it.map((x) => x.text) } : { t: "para", text: it[0].raw },
				);
			}
			const table = it.length >= 2 ? tryDashTable(it, false) : null;
			if (table) return blocks.push(table);
			const next = runs[i + 1];
			if (it.length === 1 && it[0].text.length <= 48 && next && next.t === "sep") return blocks.push({ t: "head", text: it[0].text });
			return blocks.push({ t: "para", text: it.map((x) => x.text).join("\n") });
		});
		blocks = mergeRecords(blocks);
		const out = [];
		for (const b of blocks) {
			const prev = out[out.length - 1];
			if ((b.t === "gap" || b.t === "sep") && (!prev || prev.t === "gap" || prev.t === "sep")) continue;
			out.push(b);
		}
		while (out.length && ["gap", "sep"].includes(out[out.length - 1].t)) out.pop();
		return { blocks: out, lines };
	}

	function mergeRecords(blocks) {
		const kvIdx = blocks.map((b, i) => (b.t === "kv" ? i : -1)).filter((i) => i >= 0);
		if (kvIdx.length < 2) return blocks;
		const keysOf = (b) => new Set(b.rows.map((r) => r[0]));
		const groups = [];
		let cur = [kvIdx[0]];
		for (let j = 1; j < kvIdx.length; j++) {
			const a = kvIdx[j - 1];
			const z = kvIdx[j];
			const between = blocks.slice(a + 1, z).every((b) => b.t === "sep" || b.t === "gap");
			const A = keysOf(blocks[a]);
			const B = keysOf(blocks[z]);
			const inter = [...A].filter((k) => B.has(k)).length;
			if (between && inter / new Set([...A, ...B]).size >= 0.6) cur.push(z);
			else {
				groups.push(cur);
				cur = [z];
			}
		}
		groups.push(cur);
		const drop = new Set();
		for (const g of groups) {
			if (g.length < 2) continue;
			blocks[g[0]] = { t: "records", recs: g.map((i) => Object.fromEntries(blocks[i].rows)) };
			for (let i = g[0] + 1; i <= g[g.length - 1]; i++) drop.add(i);
		}
		return blocks.filter((b, i) => !drop.has(i));
	}

	const urls = (html) => html.replace(/(https?:\/\/\S+)/g, '<bdi class="prc-url" dir="ltr">$1</bdi>');

	function hlText(text) {
		return urls(esc(text))
			.replace(/(SA\d{2}[\d*]{10,30})/g, '<span class="prc-hl prc-mono">$1</span>')
			.replace(/(^|\s)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{3,}(?:\.\d+)?)(?=$|\s|[،,.؛:)](?:\s|$))/gm, '$1<span class="prc-hl">$2</span>');
	}

	function cellHtml(value) {
		if (isBlank(value)) return "";
		return `<span>${esc(value)}</span>`;
	}

	function tableHtml(cols, rows, meta, opts = {}) {
		const big = rows.length > PAGE;
		const idx = (cell) => (opts.numbered ? cell : "");
		const head = `<tr>${idx('<th class="is-idx">#</th>')}${cols.map((c, i) => `<th class="${meta[i]?.num ? "is-num" : ""}">${esc(c)}</th>`).join("")}</tr>`;
		const body = rows
			.map((r, ri) => {
				const cells = cols
					.map(
						(c, i) =>
							`<td class="${meta[i]?.id ? "is-id" : meta[i]?.num ? "is-num" : ""}" data-label="${esc(c)}">${cellHtml(r[i])}</td>`,
					)
					.join("");
				return `<tr${big && ri >= PAGE ? " hidden data-extra" : ""}>${idx(`<td class="is-idx">${ri + 1}</td>`)}${cells}</tr>`;
			})
			.join("");
		let foot = "";
		if (opts.totals && opts.totals.some((t) => t !== null)) {
			const cells = cols
				.map((c, i) => {
					if (opts.totals[i] !== null)
						return `<td class="is-num" data-label="${esc(__("Total: {0}", [c]))}">${money(opts.totals[i])}</td>`;
					return i === 0 ? `<td data-label="">${esc(__("Total ({0})", [rows.length]))}</td>` : '<td data-label="" class="prc-empty"></td>';
				})
				.join("");
			foot = `<tfoot><tr>${idx('<td class="is-idx"></td>')}${cells}</tr></tfoot>`;
		}
		const tools = big
			? `<div class="prc-ttools"><input type="search" class="prc-tsearch" placeholder="${esc(__("Search in table"))}" aria-label="${esc(__("Search in table"))}" data-tsearch><button type="button" class="prc-more" data-tall>${esc(__("Show all rows ({0})", [rows.length]))}</button></div>`
			: "";
		return `<div class="prc-tbl" data-tbl>${tools}<div class="prc-tablewrap"><table class="prc-table ${opts.cards ? "prc-table--cards" : ""}"><thead>${head}</thead><tbody>${body}</tbody>${foot}</table></div></div>`;
	}

	function renderRecords(recs) {
		const keys = [];
		recs.forEach((r) => Object.keys(r).forEach((k) => keys.includes(k) || keys.push(k)));
		const common = keys.filter((k) => recs.every((r) => r[k] !== undefined && r[k] === recs[0][k]));
		const cols = keys.filter((k) => !common.includes(k));
		const rows = recs.map((r) => cols.map((k) => r[k] ?? ""));
		let total = null;
		let totalKey = null;
		for (const k of keys) {
			if (!AMOUNT_KEY.test(k)) continue;
			const vals = recs.map((r) => parseNum(r[k] ?? ""));
			if (vals.every((v) => v !== null)) {
				total = vals.reduce((a, b) => a + b, 0);
				totalKey = k;
				break;
			}
		}
		const commonHtml = common.length
			? `<div class="prc-common"><span class="prc-chip prc-chip--plain">${esc(__("Values shared by all rows"))}</span>${common.map((k) => `<span class="prc-chip prc-chip--plain"><bdi>${esc(k)}</bdi>: <b><bdi>${esc(recs[0][k])}</bdi></b></span>`).join("")}</div>`
			: "";
		const totalHtml =
			total !== null
				? `<span class="prc-chip prc-chip--plain">${esc(__("Total {0}", [totalKey]))}: <b>${money(total)}</b></span>`
				: "";
		const table = cols.length
			? tableHtml(cols, rows, colMeta(rows, cols.length), {
					numbered: true,
					totals: cols.map((k) => (k === totalKey ? total : null)),
					cards: true,
				})
			: "";
		return `${commonHtml}${table}${totalHtml ? `<div class="prc-tsum">${totalHtml}</div>` : ""}`;
	}

	function renderKv(block) {
		let last = -1;
		block.rows.forEach(([k, v], i) => {
			if (TOTAL_KEY.test(k) && parseNum(v) !== null) last = i;
		});
		const rows = block.rows
			.map(([k, v], i) => {
				const num = NUM_ONLY.test(v) || /^SA[\d*]{10,}/.test(v);
				const shown = i === last ? money(parseNum(v)) : num ? `<span>${esc(v)}</span>` : urls(esc(v));
				return `<tr class="${i === last ? "is-total" : ""}"><th scope="row">${esc(k)}</th><td class="${num ? "is-num" : ""}">${shown}</td></tr>`;
			})
			.join("");
		return `<div class="prc-rb"><div class="prc-tablewrap"><table class="prc-table prc-table--kv"><tbody>${rows}</tbody></table></div></div>`;
	}

	function renderTable(block) {
		const totals = block.cols.map(() => null);
		for (const ci of block.amountCols || []) {
			const vals = block.rows.map((r) => parseNum(r[ci] ?? ""));
			if (vals.every((v) => v !== null)) {
				totals[ci] = vals.reduce((a, c) => a + c, 0);
			}
		}
		const table = tableHtml(block.cols, block.rows, block.meta, { numbered: block.numbered, totals, cards: block.cols.length > 2 });
		return `<div class="prc-rb">${table}</div>`;
	}

	function renderBlocks(parsed) {
		return parsed.blocks
			.map((b) => {
				if (b.t === "sep") return '<hr class="prc-hr">';
				if (b.t === "head") return `<h4 class="prc-h prc-rb">${esc(b.text)}</h4>`;
				if (b.t === "formula") return `<div class="prc-rb"><span class="prc-formula">${esc(b.text)}</span></div>`;
				if (b.t === "para") {
					const text = b.kvLine ? `<b>${esc(b.kvLine.k)}:</b> ${hlText(b.kvLine.v)}` : hlText(b.text);
					return `<p class="prc-p prc-rb">${text}</p>`;
				}
				if (b.t === "kv") return renderKv(b);
				if (b.t === "ids") {
					const idLike = b.ids.every((x) => /^[12]\d{9}$/.test(x));
					const label = idLike ? __("ID or Iqama numbers") : __("Reference numbers");
					return `<div class="prc-rb"><div class="prc-ids-head"><span class="prc-chip prc-chip--blue">${b.ids.length}</span>${esc(label)}</div><div class="prc-ids">${b.ids.map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>`;
				}
				if (b.t === "list") {
					const tag = b.ordered ? "ol" : "ul";
					return `<${tag} class="prc-list prc-rb">${b.items.map((x) => `<li>${hlText(x)}</li>`).join("")}</${tag}>`;
				}
				if (b.t === "table") return renderTable(b);
				if (b.t === "records") return `<div class="prc-rb">${renderRecords(b.recs)}</div>`;
				return "";
			})
			.join("");
	}

	function ibanValid(iban) {
		const rearranged = iban.slice(4) + iban.slice(0, 4);
		let remainder = 0;
		for (const ch of rearranged) {
			for (const digit of /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)) remainder = (remainder * 10 + Number(digit)) % 97;
		}
		return remainder === 1;
	}

	const copyBtn = (raw) => `<button type="button" class="ch-copy" data-copy="${esc(raw)}">${esc(__("Copy"))}</button>`;

	function sadadValues(doc) {
		if (!SADAD.includes(doc.payment_type)) return null;
		let biller = doc.sadad_biller_code;
		let bill = doc.sadad_bill_number;
		const account = String(doc.account_no || "").trim();
		if (isBlank(biller) && isBlank(bill)) {
			if (/^SA\d{22}$/.test(account.replace(/\s+/g, "").toUpperCase())) return null;
			if (/^\d{2,4}$/.test(account)) biller = account;
			else bill = account;
		}
		return { biller, bill };
	}

	const chip = (tone, text) => `<span class="prc-chip prc-chip--${tone}">${esc(text)}</span>`;

	function accountStrip(doc) {
		if (doc.multiple_beneficiaries) return "";
		const v = sadadValues(doc);
		if (v) {
			const seg = (label, value, narrow) =>
				isBlank(value)
					? ""
					: `<div class="ch-acct__seg ${narrow ? "ch-acct__seg--narrow" : ""}"><span class="ch-k">${label}</span><div class="ch-acct__val"><b class="${/^[\d\s-]+$/.test(value) ? "ch-iban" : "ch-text"}">${esc(value)}</b>${copyBtn(String(value).trim())}</div></div>`;
			const segs = seg(`${esc(__("Biller code"))}<span class="ch-tag">${esc(__("SADAD"))}</span>`, v.biller, true) + seg(esc(__("SADAD bill number")), v.bill);
			return segs ? `<div class="ch-acct" data-kind="sadad">${segs}</div>` : "";
		}
		const account = String(doc.account_no || "").trim();
		if (!account) return "";
		const compact = account.replace(/\s+/g, "").toUpperCase();
		const iban = /^SA\d{22}$/.test(compact);
		let meta = chip("amber", __("Value is not an IBAN"));
		if (iban) {
			const bank = BANKS[compact.slice(4, 6)];
			const valid = ibanValid(compact);
			meta = `${bank ? `<span>${esc(__("Bank"))}: <b>${esc(__(bank))}</b></span>` : ""}${valid ? chip("green", __("IBAN is valid")) : chip("red", __("IBAN is not valid"))}`;
		}
		const shown = iban ? compact.replace(/(.{4})/g, "$1 ").trim() : account;
		return `<div class="ch-acct" data-kind="account"><div class="ch-acct__seg"><span class="ch-k">${esc(iban ? __("IBAN") : __("Account number"))}</span><div class="ch-acct__val"><b class="${iban ? "ch-iban" : "ch-text"}">${esc(shown)}</b>${copyBtn(iban ? compact : account)}</div></div><div class="ch-acct__meta">${meta}</div></div>`;
	}

	function flowHtml(frm, path) {
		if (!path) return "";
		const state = frm.doc.workflow_state;
		const head = path.halted
			? frm.doc.docstatus === 2
				? __("Request cancelled")
				: __("Request rejected")
			: path.current >= path.stages.length
				? __("Path complete")
				: __("Step {0} of {1}", [path.current + 1, path.stages.length]);
		const stepper = afmco.stepper.html({ ...path, color: path.halted ? "red" : "green" });
		const now = path.stages[path.current];
		const nowHtml = now ? `<div class="prc-flow__now">${esc(__(now))}</div>` : "";
		return `<section class="prc-flow" aria-label="${esc(__("Request path"))}"><div class="prc-flow__head"><b>${esc(__("Request path"))}</b><span>${esc(head)}</span>${path.halted ? chip("red", __(state)) : ""}</div>${stepper}${nowHtml}</section>`;
	}

	function flagsHtml(doc) {
		const flag = (kind, icon, title, extra = "") =>
			`<div class="prc-flag prc-flag--${kind}"><span class="prc-flag__icon">${icon}</span><span class="prc-flag__body"><span class="prc-flag__title">${esc(title)}</span>${extra}</span></div>`;
		const reason = isBlank(doc.reason_of_urgency) ? "" : `<div class="prc-flag__reason">${clamp(esc(doc.reason_of_urgency), 2)}</div>`;
		return [
			doc.if_it__urgent ? flag("urgent", "!", __("Urgent"), reason) : "",
			doc.verify_payment ? flag("paid", "✓", __("Paid before")) : "",
			doc.multiple_beneficiaries ? flag("multi", "⋯", __("Multiple beneficiaries")) : "",
		].join("");
	}

	function chequeHtml(frm) {
		const doc = frm.doc;
		const state = doc.workflow_state;
		const tone = STATE_TONE[state];
		const words = doc.__unsaved
			? ""
			: String((doc.__onload || {}).amount_in_words || doc.amount_in_words || "")
					.replace(/^SAR\s*/, "")
					.trim();
		const sadad = sadadValues(doc);
		const micr = doc.multiple_beneficiaries
			? ""
			: sadad
				? sadad.bill || sadad.biller || ""
				: String(doc.account_no || "").replace(/[^A-Za-z0-9]/g, "");
		const payee = isBlank(doc.beneficiary_name)
			? doc.multiple_beneficiaries
				? esc(__("Multiple beneficiaries"))
				: ""
			: clamp(esc(doc.beneficiary_name), 2);
		const cell = (label, value) =>
			isBlank(value) ? "" : `<div class="ch-cell"><span class="ch-k">${esc(label)}</span><b>${clamp(mixed(value), 2)}</b></div>`;
		const showBankDate = !isBlank(doc.bank_payment_date) && (doc.verify_payment || BANK_DATE_STATES.includes(state));
		const date = (label, value) =>
			isBlank(value) ? "" : `<div class="prc-dt"><span class="prc-label">${esc(label)}</span><b class="prc-ltr prc-num">${esc(value)}</b></div>`;
		return `<section class="prc-cheque" aria-label="${esc(__("Payment order"))}">
			<div class="ch-head"><div class="ch-kind">${esc(__("Payment order"))} <span class="prc-mono ch-ref">${esc(doc.name)}</span></div>${state ? `<div class="ch-chips">${chip(tone || "plain", __(state))}</div>` : ""}</div>
			<div class="ch-top">${payee ? `<div class="ch-pay"><span class="ch-k">${esc(__("Pay to the order of"))}</span><div class="ch-name">${payee}</div></div>` : ""}<div class="ch-amt"><b>${money(doc.amount)}</b></div></div>
			${words ? `<div class="ch-words"><bdi dir="auto">${esc(words)}</bdi></div>` : ""}
			${accountStrip(doc)}
			<div class="ch-grid">${cell(__("Project"), doc.cost_center)}${cell(__("Cost Center"), doc.project)}<div class="prc-cheque__dates">${date(__("Request date"), day(doc.creation))}${showBankDate ? date(__("Bank Payment Date"), day(doc.bank_payment_date)) : ""}</div></div>
			${isBlank(doc.payment_approver) ? "" : `<div class="ch-foot"><span><span>${esc(__("Payment Approver"))}:</span> <b>${mixed(doc.payment_approver)}</b></span></div>`}
			<div class="ch-micr" aria-hidden="true">⑆ ${esc(doc.name)} ⑆ ${micr ? `<span class="ch-micr__acct">${esc(micr)} ⑈ </span>` : ""}${amount(doc.amount)} ⑈</div>
		</section>`;
	}

	function remarkHtml(frm, mode) {
		const parsed = parseRemark(frm.doc.remark);
		const raw = parsed.lines.join("\n");
		if (!raw.trim()) return "";
		const seg = `<div class="prc-seg" role="group"><button type="button" data-rmode="smart" aria-pressed="${mode === "smart"}">${esc(__("Formatted"))}</button><button type="button" data-rmode="raw" aria-pressed="${mode === "raw"}">${esc(__("Original text"))}</button></div>`;
		const body = mode === "raw" ? `<pre class="prc-raw">${esc(raw)}</pre>` : renderBlocks(parsed);
		return `<div class="prc-tear" aria-hidden="true"><span>${esc(__("Remark"))}</span></div><section class="prc-remark" aria-label="${esc(__("Remark"))}">
			<div class="prc-remark__head"><div class="prc-remark__meta"><h3 class="prc-card__title">${esc(__("Remark"))}</h3></div>${seg}</div>
			<div class="prc-remark__body" data-rbody>${body}</div>
			<div class="prc-remark__foot" hidden><button type="button" class="prc-more" data-rexpand>${esc(__("Show full remark"))}</button></div>
		</section>`;
	}

	function field(label, value) {
		return isBlank(value) ? "" : `<div class="prc-field"><div class="prc-label">${esc(label)}</div><div class="prc-field__val">${value}</div></div>`;
	}

	const grid = (cols, ...fields) => {
		const html = fields.join("");
		return html ? `<div class="prc-grid prc-grid--${cols}">${html}</div>` : "";
	};

	function sectionsHtml(frm) {
		const doc = frm.doc;
		const state = doc.workflow_state;
		const cards = [];
		const no = () => `<span class="prc-card__no prc-num">${String(cards.length + 1).padStart(2, "0")}</span>`;
		const val = (v) => (isBlank(v) ? "" : esc(v));
		if (BANK_ENTRY.includes(state) || BANK_LOCKED.includes(state) || !isBlank(doc.bank_reference_cf)) {
			const paid = flt(doc.paid_amount_cf) ? money(doc.paid_amount_cf) : "";
			const rows =
				grid(2, field(__("Bank Account"), val(doc.bank_account)), field(__("Bank Payment Date"), isBlank(doc.bank_payment_date) ? "" : ltr(day(doc.bank_payment_date), "prc-num"))) +
				grid(2, field(__("Bank Reference"), val(doc.bank_reference_cf)), field(__("Paid Amount"), paid));
			if (rows) cards.push(`<section class="prc-card"><div class="prc-card__head"><h3 class="prc-card__title">${no()}${esc(__("Bank payment"))}</h3></div><div class="prc-card__body">${rows}</div></section>`);
		}
		const note = grid(1, field(__("Accounts Bot Note"), isBlank(doc.accounts_bot_note) ? "" : clamp(`<bdi dir="auto">${frappe.format(doc.accounts_bot_note, { fieldtype: "Small Text" })}</bdi>`, 3)));
		const je = jeShown(frm);
		const dates = je
			? paymentDates(frm)
					.map(
						([entry, posted]) =>
							`<div class="prc-dt prc-dt--je"><span class="prc-label">${esc(__("Journal Entry"))} <span class="prc-ltr prc-mono">${esc(entry)}</span></span><b class="prc-ltr prc-num">${esc(day(posted))}</b></div>`,
					)
					.join("")
			: "";
		cards.push(`<section class="prc-card"><div class="prc-card__head"><h3 class="prc-card__title">${no()}${esc(__("Additional details"))}</h3></div><div class="prc-card__body">
			${grid(2, field(__("Payment Type"), isBlank(doc.payment_type) ? "" : esc(__(doc.payment_type))), je ? field(__("JV Status"), isBlank(doc.jv_status) ? "" : esc(doc.jv_status === "JV Not Created" ? __("Awaiting Journal Entry") : __(doc.jv_status))) : "")}
			${dates ? `<div class="prc-jedates">${dates}</div>` : ""}
			${grid(2, field(__("Reference"), isBlank(doc.tax_invoice_number) ? "" : clamp(esc(doc.tax_invoice_number), 2)), field(__("Last modified"), isBlank(doc.modified) ? "" : ltr(stamp(doc.modified), "prc-num")))}
			${grid(3, field(__("Accounts Bot Status"), isBlank(doc.accounts_bot_status) ? "" : esc(__(doc.accounts_bot_status))), field(__("Accounts Bot Updated"), isBlank(doc.accounts_bot_updated) ? "" : ltr(stamp(doc.accounts_bot_updated), "prc-num")), field(__("Sent to Accounts Bot"), esc(doc.accounts_bot_cf ? __("Yes") : __("No"))))}
			${note}
		</div></section>`);
		return cards.join("");
	}

	function measure(root) {
		root.querySelectorAll(".prc-clamp").forEach((el) => {
			const btn = el.nextElementSibling;
			if (!btn || !btn.hasAttribute("data-more")) return;
			btn.hidden = !el.classList.contains("is-open") && !(el.scrollHeight > el.clientHeight + 2);
		});
		const body = root.querySelector("[data-rbody]");
		if (!body) return;
		body.classList.remove("is-tall");
		const tall = body.scrollHeight > 640;
		body.classList.toggle("is-tall", tall);
		const foot = body.nextElementSibling;
		foot.hidden = !tall;
		if (tall)
			foot.querySelector("button").textContent = body.classList.contains("is-open") ? __("Collapse remark") : __("Show full remark");
	}

	function settle(root) {
		if (!root.offsetParent) return;
		measure(root);
		afmco.stepper.center(root);
	}

	function bind(frm, $wrapper) {
		const root = $wrapper[0];
		$wrapper.off(".prc");
		$wrapper.on("click.prc", "[data-copy]", (e) => frappe.utils.copy_to_clipboard(e.currentTarget.dataset.copy));
		$wrapper.on("click.prc", "[data-more]", (e) => {
			const el = e.currentTarget.previousElementSibling;
			el.classList.toggle("is-open");
			e.currentTarget.textContent = el.classList.contains("is-open") ? __("Collapse") : __("Show all");
		});
		$wrapper.on("click.prc", "[data-rmode]", (e) => {
			frm.prc_remark_mode = e.currentTarget.dataset.rmode;
			afmco.pr_summary.render(frm);
		});
		$wrapper.on("click.prc", "[data-rexpand]", () => {
			root.querySelector("[data-rbody]").classList.toggle("is-open");
			measure(root);
		});
		$wrapper.on("click.prc", "[data-tall]", (e) => {
			const box = e.currentTarget.closest("[data-tbl]");
			const all = box.dataset.all !== "1";
			box.dataset.all = all ? "1" : "";
			const search = box.querySelector("[data-tsearch]");
			if (search) search.value = "";
			const rows = box.querySelectorAll("tbody tr");
			rows.forEach((tr) => (tr.hidden = !all && tr.hasAttribute("data-extra")));
			e.currentTarget.textContent = all ? __("Show first {0} rows", [PAGE]) : __("Show all rows ({0})", [rows.length]);
			measure(root);
		});
		$wrapper.on("input.prc", "[data-tsearch]", (e) => {
			const box = e.currentTarget.closest("[data-tbl]");
			const q = e.currentTarget.value.trim().toLowerCase();
			box.querySelectorAll("tbody tr").forEach((tr) => {
				tr.hidden = q ? !tr.textContent.toLowerCase().includes(q) : tr.hasAttribute("data-extra") && box.dataset.all !== "1";
			});
			measure(root);
		});
		const tab = frm.layout.tabs.find((t) => t.df.fieldname === "summary_tab");
		tab?.tab_link
			.find(".nav-link")
			.off(".prc")
			.on("click.prc", () => requestAnimationFrame(() => settle(root)));
	}

	afmco.pr_summary = {
		render(frm) {
			const control = frm.get_field("summary_html");
			if (!control || frm.is_new()) return;
			const $wrapper = control.$wrapper;
			const path = afmco.stepper.workflow(frm);
			const flags = flagsHtml(frm.doc);
			$wrapper.empty().html(`<div class="afmco-pr-summary">
				<div class="prc__layout ${flags ? "" : "no-top"}">
					${flowHtml(frm, path)}
					${flags ? `<div class="prc__top">${flags}</div>` : ""}
					<div class="prc__doc">${chequeHtml(frm)}${remarkHtml(frm, frm.prc_remark_mode || "smart")}</div>
					<div class="prc__sections">${sectionsHtml(frm)}</div>
				</div>
			</div>`);
			bind(frm, $wrapper);
			requestAnimationFrame(() => settle($wrapper[0]));
		},
	};
})();
