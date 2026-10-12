(function () {
	const form = document.querySelector(".afm-form");
	if (!form) return;

	const status = form.querySelector(".afm-form__status");
	const submit = form.querySelector('button[type="submit"]');
	const iban = form.querySelector('input[name="iban"]');
	const bank = form.querySelector(".afm-iban__bank");
	const banks = JSON.parse(form.dataset.banks || "{}");
	const blocks = [...form.querySelectorAll("[data-show-when]")];

	const show = (target, message, kind) => {
		target.textContent = message;
		target.classList.toggle("is-error", kind === "error");
		target.classList.toggle("is-done", kind === "done");
	};

	const serverMessage = (body) => {
		try {
			const messages = JSON.parse(body._server_messages || "[]");
			const first = messages.length ? JSON.parse(messages[0]) : null;
			const text = first && first.message ? first.message : "";
			const holder = document.createElement("div");
			holder.innerHTML = text;
			return holder.textContent.trim();
		} catch (error) {
			return "";
		}
	};

	const normalise = (value) => value.replace(/[\s\-_]+/g, "").toUpperCase();

	const showBank = () => {
		const value = normalise(iban.value);
		if (!/^SA\d{4}/.test(value)) {
			show(bank, "", "");
			return;
		}
		const code = banks[value.slice(4, 6)];
		if (code) {
			show(bank, form.dataset.msgBank.replace("{0}", code), "done");
		} else {
			show(bank, form.dataset.msgBankUnknown, "error");
		}
	};

	const syncBlocks = () => {
		blocks.forEach((block) => {
			const [name, value] = block.dataset.showWhen.split("=");
			const checked = form.querySelector(`input[name="${name}"]:checked`);
			const visible = Boolean(checked && checked.value === value);
			block.hidden = !visible;
			block.querySelectorAll("input, textarea").forEach((field) => {
				field.disabled = !visible;
			});
		});
	};

	iban.addEventListener("input", showBank);
	form.addEventListener("change", syncBlocks);
	syncBlocks();

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const required = [...form.querySelectorAll("[required]")].filter((field) => !field.disabled);
		const empty = (field) => (field.type === "checkbox" ? !field.checked : !field.value.trim());
		required.forEach((field) => field.setAttribute("aria-invalid", String(empty(field))));
		const missing = required.find(empty);
		if (missing) {
			show(status, form.dataset.msgRequired, "error");
			missing.focus();
			return;
		}

		submit.disabled = true;
		show(status, "", "");
		try {
			const response = await fetch(form.action, {
				method: "POST",
				body: new FormData(form),
				headers: {
					Accept: "application/json",
					"X-Frappe-CSRF-Token": (window.frappe && window.frappe.csrf_token) || "",
				},
			});
			const body = await response.json().catch(() => ({}));
			if (response.ok) {
				form.reset();
				syncBlocks();
				show(bank, "", "");
				show(status, form.dataset.msgSent.replace("{0}", (body.message && body.message.name) || ""), "done");
			} else {
				show(status, serverMessage(body) || form.dataset.msgFailed, "error");
			}
		} catch (error) {
			show(status, form.dataset.msgFailed, "error");
		} finally {
			submit.disabled = false;
		}
	});
})();
