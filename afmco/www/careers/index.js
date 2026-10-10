(function () {
	const form = document.querySelector(".afm-form");
	if (!form) return;

	const status = form.querySelector(".afm-form__status");
	const submit = form.querySelector('button[type="submit"]');
	const jobSelect = form.querySelector('select[name="job_title"]');
	const resume = form.querySelector('input[name="resume"]');
	const allowed = [".pdf", ".doc", ".docx"];

	const show = (message, kind) => {
		status.textContent = message;
		status.classList.toggle("is-error", kind === "error");
		status.classList.toggle("is-done", kind === "done");
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

	document.querySelectorAll("[data-job]").forEach((link) => {
		link.addEventListener("click", (event) => {
			event.preventDefault();
			jobSelect.value = link.dataset.job;
			document.getElementById("apply").scrollIntoView({ behavior: "smooth" });
			form.querySelector('input[name="applicant_name"]').focus({ preventScroll: true });
		});
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const required = [...form.querySelectorAll("[required]")];
		required.forEach((field) => field.setAttribute("aria-invalid", String(!field.value.trim())));
		const missing = required.find((field) => !field.value.trim());
		if (missing) {
			show(form.dataset.msgRequired, "error");
			missing.focus();
			return;
		}

		const file = resume.files[0];
		if (file) {
			const name = file.name.toLowerCase();
			if (!allowed.some((extension) => name.endsWith(extension))) {
				show(form.dataset.msgFile, "error");
				resume.focus();
				return;
			}
			if (file.size > Number(form.dataset.maxBytes)) {
				show(form.dataset.msgSize, "error");
				resume.focus();
				return;
			}
		}

		submit.disabled = true;
		show("", "");
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
				show(form.dataset.msgSent, "done");
			} else {
				show(serverMessage(body) || form.dataset.msgFailed, "error");
			}
		} catch (error) {
			show(form.dataset.msgFailed, "error");
		} finally {
			submit.disabled = false;
		}
	});
})();
