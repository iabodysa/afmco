// Copyright (c) 2026, AFMCO and contributors

frappe.pages['action-inbox'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('My Work Center'),
		single_column: true,
	});
	wrapper.action_inbox = new ActionInbox(page);
};

// Cards shown per section before the Show all button
const AI_VISIBLE = 12;

class ActionInbox {
	constructor(page) {
		this.page = page;
		this._gen = 0;
		this._build_skeleton();
		this.page.set_primary_action(__('Refresh'), () => this.refresh(), 'refresh');
		frappe.realtime.on('notification', frappe.utils.debounce(() => this.refresh(), 5000));
		this.refresh();
	}

	_build_skeleton() {
		this.$root = $('<div class="action-inbox"></div>').appendTo(this.page.main);
		this.$summary = $('<div class="ai-summary"></div>').appendTo(this.$root);

		this.$approvalsSection = this._section(__('Pending Approvals'), 'blue');
		this.$approvals = this.$approvalsSection.find('.ai-list');
		this.$tasksSection = this._section(__('Assigned Tasks'), 'orange');
		this.$tasks = this.$tasksSection.find('.ai-list');
		this.$actedSection = this._section(__('Acted On My Documents'), 'purple');
		this.$acted = this.$actedSection.find('.ai-list');
		this.$submittedSection = this._section(__('My Open Submissions'), 'green');
		this.$submitted = this.$submittedSection.find('.ai-list');
		this.$closedSection = this._section(__('Closed in the Last 48h'), 'gray');
		this.$closed = this.$closedSection.find('.ai-list');
		this.$notifsSection = this._section(__('Notifications'), 'cyan');
		this.$notifs = this.$notifsSection.find('.ai-list');

		this.$empty = $('<div class="ai-empty text-muted"></div>').appendTo(this.$root);
		this._allSections = [
			this.$approvalsSection, this.$tasksSection, this.$actedSection,
			this.$submittedSection, this.$closedSection, this.$notifsSection,
		];
	}

	_section(title, tone) {
		const $s = $(`<section class="ai-section ai-tone-${tone}"></section>`).appendTo(this.$root);
		const $head = $('<header class="ai-section-head"></header>').appendTo($s);
		$('<span class="ai-section-title"></span>').text(title).appendTo($head);
		$('<span class="ai-section-count"></span>').appendTo($head);
		$('<button type="button" class="btn btn-xs btn-default ai-section-toggle"></button>')
			.text(__('Hide'))
			.on('click', () => {
				$s.toggleClass('ai-collapsed');
				$head.find('.ai-section-toggle').text($s.hasClass('ai-collapsed') ? __('Show') : __('Hide'));
			})
			.appendTo($head);
		$('<div class="ai-list"></div>').appendTo($s);
		$('<button type="button" class="btn btn-sm btn-default ai-more"></button>').hide().appendTo($s);
		$s.data('title', title);
		return $s;
	}

	_finish_section($s, total) {
		$s.find('.ai-section-count').text(total);
		const $cards = $s.find('.ai-card');
		const $more = $s.find('.ai-more');
		if ($cards.length <= AI_VISIBLE) {
			$more.hide();
			return;
		}
		$cards.slice(AI_VISIBLE).addClass('ai-hidden');
		$more.text(__('Show all {0}', [$cards.length])).show().off('click').on('click', () => {
			$cards.removeClass('ai-hidden');
			$more.hide();
		});
	}

	_render_summary() {
		this.$summary.empty();
		this._allSections.forEach(($s) => {
			const total = $s.find('.ai-card').length;
			if (!total) return;
			$('<button type="button" class="ai-summary-tile"></button>')
				.addClass(($s.attr('class').match(/ai-tone-\w+/) || [''])[0])
				.append($('<span class="ai-summary-count"></span>').text(total))
				.append($('<span class="ai-summary-label"></span>').text($s.data('title')))
				.on('click', () => $s[0].scrollIntoView({ behavior: 'smooth', block: 'start' }))
				.appendTo(this.$summary);
		});
	}

	refresh() {
		const ticket = ++this._gen;
		this._render_loading();
		frappe
			.call('afmco.people_and_payroll.api.my_work_center.get_my_work')
			.then((r) => {
				if (ticket !== this._gen) return;
				this._render((r && r.message) || {});
			})
			.catch(() => {
				if (ticket === this._gen) this._render_error();
			});
	}

	_render(data) {
		const awaiting = data.awaiting_action || {};
		const workflow_actions = awaiting.workflow_actions || [];
		const todos = awaiting.todos || [];
		const acted = data.acted_on_my_documents || [];
		const submitted = data.my_open_submitted || [];
		const closed = data.my_recent_closed || [];
		const notifs = data.my_notifications || [];

		[this.$approvals, this.$tasks, this.$acted, this.$submitted, this.$closed, this.$notifs].forEach(($l) =>
			$l.empty()
		);

		this.$approvalsSection.toggle(workflow_actions.length > 0);
		this.$tasksSection.toggle(todos.length > 0);
		this.$actedSection.toggle(acted.length > 0);
		this.$submittedSection.toggle(submitted.length > 0);
		this.$closedSection.toggle(closed.length > 0);
		this.$notifsSection.toggle(notifs.length > 0);

		const anything =
			workflow_actions.length || todos.length || acted.length || submitted.length || closed.length || notifs.length;
		if (!anything) {
			this.$empty.text(__('Nothing on your work center right now.')).show();
			return;
		}
		this.$empty.empty().hide();

		workflow_actions.forEach((row) => this._workflow_card(row));
		todos.forEach((row) => this._todo_card(row));
		acted.forEach((row) => this._acted_card(row));
		submitted.forEach((row) => this._doc_card(this.$submitted, row, 'green'));
		closed.forEach((row) => this._doc_card(this.$closed, row, 'gray'));
		notifs.forEach((row) => this._notification_card(row));

		this._allSections.forEach(($s) => this._finish_section($s, $s.find('.ai-card').length));
		this._render_summary();
		this.$summary.show();
	}

	_render_loading() {
		this._allSections.forEach(($s) => $s.hide());
		this.$summary.hide();
		this.$empty.text(__('Loading…')).show();
	}

	_render_error() {
		this._allSections.forEach(($s) => $s.hide());
		this.$summary.hide();
		this.$empty.empty();
		$('<div class="ai-error-msg"></div>')
			.text(__('Could not load your work center. Please retry.'))
			.css({ 'margin-block-end': 'var(--margin-sm, 10px)' })
			.appendTo(this.$empty);
		$('<button class="btn btn-default btn-sm"></button>')
			.text(__('Retry'))
			.on('click', () => this.refresh())
			.appendTo(this.$empty);
		this.$empty.show();
	}

	_workflow_card(row) {
		const $card = $('<div class="ai-card ai-card--workflow"></div>').appendTo(this.$approvals);
		const $head = $('<div class="ai-card-head"></div>').appendTo($card);
		$('<span class="indicator-pill no-indicator-dot blue"></span>').text(__(row.reference_doctype || '')).appendTo($head);
		$('<a class="ai-card-link" href="#"></a>')
			.text(row.reference_name || '')
			.on('click', (e) => {
				e.preventDefault();
				frappe.set_route('Form', row.reference_doctype, row.reference_name);
			})
			.appendTo($head);

		const $meta = $('<div class="ai-card-meta text-muted"></div>').appendTo($card);
		$('<span class="ai-card-state"></span>').text(__('State: {0}', [__(row.workflow_state || '')])).appendTo($meta);

		const $actions = $('<div class="ai-card-actions"></div>').appendTo($card);
		this._render_transitions($actions, $card, row, row.transitions || []);
	}

	_render_transitions($actions, $card, row, transitions) {
		$actions.empty();
		if (!transitions.length) {
			$('<span class="ai-actions-none text-muted"></span>').text(__('No actions available.')).appendTo($actions);
			return;
		}
		const seen = new Set();
		transitions.forEach((t) => {
			const action = t.action || '';
			if (!action || seen.has(action)) return;
			seen.add(action);
			const danger = /reject|cancel/i.test(action);
			const cls = danger ? 'btn-danger' : 'btn-primary';
			$(`<button class="btn btn-sm ${cls} ai-action-btn"></button>`)
				.text(__(action))
				.on('click', () => this._apply_workflow($card, row, action))
				.appendTo($actions);
		});
	}

	_apply_workflow($card, row, action) {
		frappe.dom.freeze(__('Applying…'));
		frappe
			.xcall('frappe.model.workflow.apply_workflow', {
				doc: { doctype: row.reference_doctype, name: row.reference_name },
				action,
			})
			.then((doc) => {
				frappe.show_alert({ message: __('{0} applied', [__(action)]), indicator: 'green' });
				this.refresh();
			})
			.catch(() => {
				frappe.show_alert({ message: __('Could not apply {0}', [__(action)]), indicator: 'red' });
				this.refresh();
			})
			.finally(() => frappe.dom.unfreeze());
	}

	_todo_card(row) {
		const $card = $('<div class="ai-card ai-card--todo"></div>').appendTo(this.$tasks);
		const $head = $('<div class="ai-card-head"></div>').appendTo($card);
		$('<span class="indicator-pill no-indicator-dot orange"></span>').text(__('Task')).appendTo($head);
		$('<a class="ai-card-link" href="#"></a>')
			.text(`${__(row.reference_doctype || '')}: ${row.reference_name || ''}`)
			.on('click', (e) => {
				e.preventDefault();
				frappe.set_route('Form', row.reference_doctype, row.reference_name);
			})
			.appendTo($head);

		if (row.description) {
			$('<div class="ai-card-desc"></div>').html(frappe.utils.escape_html(row.description)).appendTo($card);
		}
		const $meta = $('<div class="ai-card-meta text-muted"></div>').appendTo($card);
		if (row.priority) {
			$('<span class="ai-card-priority"></span>').text(__('Priority: {0}', [__(row.priority)])).appendTo($meta);
		}
		if (row.date) {
			$('<span class="ai-card-date"></span>').text(__('Due: {0}', [row.date])).appendTo($meta);
		}
		const $actions = $('<div class="ai-card-actions"></div>').appendTo($card);
		$('<button class="btn btn-sm btn-default ai-action-btn"></button>')
			.text(__('Open'))
			.on('click', () => frappe.set_route('Form', row.reference_doctype, row.reference_name))
			.appendTo($actions);
		$('<button class="btn btn-sm btn-primary ai-action-btn"></button>')
			.text(__('Close'))
			.on('click', () => this._close_todo($card, row))
			.appendTo($actions);
	}

	_close_todo($card, row) {
		frappe.dom.freeze(__('Closing…'));
		frappe
			.xcall('frappe.client.set_value', { doctype: 'ToDo', name: row.name, fieldname: 'status', value: 'Closed' })
			.then(() => {
				frappe.show_alert({ message: __('Task closed'), indicator: 'green' });
				this.refresh();
			})
			.catch(() => {
				frappe.show_alert({ message: __('Could not close the task'), indicator: 'red' });
				this.refresh();
			})
			.finally(() => frappe.dom.unfreeze());
	}

	_doc_card($list, row, color) {
		const $card = $('<div class="ai-card ai-card--doc"></div>').appendTo($list);
		const $head = $('<div class="ai-card-head"></div>').appendTo($card);
		$(`<span class="indicator-pill no-indicator-dot ${color}"></span>`).text(__(row.doctype || '')).appendTo($head);
		$('<a class="ai-card-link" href="#"></a>')
			.text(row.name || '')
			.on('click', (e) => {
				e.preventDefault();
				frappe.set_route('Form', row.doctype, row.name);
			})
			.appendTo($head);
		const $meta = $('<div class="ai-card-meta text-muted"></div>').appendTo($card);
		$('<span class="ai-card-state"></span>').text(__('Status: {0}', [__(row.status || '')])).appendTo($meta);
	}

	_acted_card(row) {
		const $card = $('<div class="ai-card ai-card--acted"></div>').appendTo(this.$acted);
		const $head = $('<div class="ai-card-head"></div>').appendTo($card);
		$('<span class="indicator-pill no-indicator-dot purple"></span>').text(__(row.doctype || '')).appendTo($head);
		$('<a class="ai-card-link" href="#"></a>')
			.text(row.name || '')
			.on('click', (e) => {
				e.preventDefault();
				frappe.set_route('Form', row.doctype, row.name);
			})
			.appendTo($head);

		const $meta = $('<div class="ai-card-meta text-muted"></div>').appendTo($card);
		if (row.status) {
			$('<span class="ai-card-state"></span>').text(__('Status: {0}', [__(row.status)])).appendTo($meta);
		}
		$('<span class="ai-card-actor"></span>').text(__('Acted on by {0}', [row.actor || ''])).appendTo($meta);
		if (row.modified) {
			$('<span class="ai-card-when"></span>').text(frappe.datetime.prettyDate(row.modified)).appendTo($meta);
		}
	}

	_notification_card(row) {
		const $card = $('<div class="ai-card ai-card--notif"></div>').appendTo(this.$notifs);
		const $head = $('<div class="ai-card-head"></div>').appendTo($card);
		$(`<span class="indicator-pill no-indicator-dot ${row.read ? 'gray' : 'blue'}"></span>`)
			.text(row.type ? __(row.type) : __('Notification'))
			.appendTo($head);
		$('<span class="ai-card-subject"></span>').css('font-weight', '600').text(row.subject || '').appendTo($head);
		if (row.document_type && row.document_name) {
			$('<a class="ai-card-link" href="#"></a>')
				.text(`${__(row.document_type || '')}: ${row.document_name || ''}`)
				.on('click', (e) => {
					e.preventDefault();
					frappe.set_route('Form', row.document_type, row.document_name);
				})
				.appendTo($card);
		}
	}
}
