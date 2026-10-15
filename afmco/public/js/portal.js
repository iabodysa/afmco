(function () {
	const root = document.querySelector(".afm");
	if (!root) return;
	root.classList.add("afm-js");

	const header = root.querySelector(".afm-header");
	const hero = root.querySelector(".afm-hero");
	const burger = root.querySelector(".afm-burger");
	const nav = root.querySelector(".afm-header__nav");
	const behind = root.querySelectorAll(".afm-skip, main, .afm-footer");
	const wide = window.matchMedia("(min-width: 1024px)");
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const observable = "IntersectionObserver" in window;

	const isOpen = () => root.classList.contains("afm--menu");
	const setMenu = (open, restoreFocus) => {
		root.classList.toggle("afm--menu", open);
		burger.setAttribute("aria-expanded", String(open));
		burger.setAttribute("aria-label", open ? burger.dataset.labelClose : burger.dataset.labelOpen);
		behind.forEach((element) => {
			element.inert = open;
		});
		if (open) nav.querySelector("a").focus();
		else if (restoreFocus) burger.focus();
	};

	burger.addEventListener("click", () => setMenu(!isOpen(), false));
	nav.addEventListener("click", (event) => {
		if (event.target.closest("a") && isOpen()) setMenu(false, false);
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && isOpen()) setMenu(false, true);
	});
	header.addEventListener("keydown", (event) => {
		if (event.key !== "Tab" || !isOpen()) return;
		const reachable = [...header.querySelectorAll("a[href], button")].filter(
			(element) => element.getClientRects().length > 0
		);
		const first = reachable[0];
		const last = reachable[reachable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	});
	wide.addEventListener("change", (event) => {
		if (event.matches && isOpen()) setMenu(false, false);
	});

	const news = root.querySelector(".afm-news");
	if (news && !reduced) {
		const track = news.querySelector(".afm-news__track");
		const flip = Number(getComputedStyle(root).getPropertyValue("--afm-flip")) || 1;
		const duration = (Number(track.style.getPropertyValue("--afm-news-count")) || 1) * 9000;
		let offset = 0;
		let last = 0;
		let resumeAt = 0;
		let drag = null;
		let moved = false;
		let hovered = false;
		let focused = false;

		const period = () => track.scrollWidth / 2;
		const place = () => {
			const width = period();
			offset = ((offset % width) + width) % width;
			track.style.setProperty("--afm-news-x", `${-offset * flip}px`);
		};
		const tick = (now) => {
			const elapsed = last ? now - last : 0;
			last = now;
			if (!drag && !hovered && !focused && now >= resumeAt) {
				offset += (period() / duration) * elapsed;
				place();
			}
			requestAnimationFrame(tick);
		};
		const release = (event) => {
			if (!drag || event.pointerId !== drag.id) return;
			drag = null;
			news.classList.remove("is-dragging");
			resumeAt = performance.now() + 2500;
		};

		news.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			drag = { id: event.pointerId, x: event.clientX, start: offset };
			moved = false;
		});
		news.addEventListener("pointermove", (event) => {
			if (!drag || event.pointerId !== drag.id) return;
			const distance = event.clientX - drag.x;
			if (!moved && Math.abs(distance) < 6) return;
			if (!moved) {
				moved = true;
				news.setPointerCapture(event.pointerId);
				news.classList.add("is-dragging");
			}
			offset = drag.start - distance * flip;
			place();
		});
		news.addEventListener("pointerup", release);
		news.addEventListener("pointercancel", release);
		news.addEventListener(
			"click",
			(event) => {
				if (!moved) return;
				moved = false;
				event.preventDefault();
				event.stopPropagation();
			},
			true
		);
		news.addEventListener("dragstart", (event) => event.preventDefault());
		news.addEventListener("pointerenter", (event) => {
			hovered = event.pointerType === "mouse";
		});
		news.addEventListener("pointerleave", () => {
			hovered = false;
		});
		news.addEventListener("focusin", () => {
			focused = true;
		});
		news.addEventListener("focusout", () => {
			focused = false;
		});

		news.classList.add("is-live");
		place();
		requestAnimationFrame(tick);
	}

	if (!observable) {
		root.classList.add("afm--solid");
		root.querySelectorAll("[data-reveal]").forEach((item) => item.classList.add("is-visible"));
		return;
	}

	new IntersectionObserver(
		([entry]) => root.classList.toggle("afm--solid", !entry.isIntersecting),
		{ rootMargin: "-72px 0px 0px 0px" }
	).observe(hero);

	const items = root.querySelectorAll("[data-reveal]");
	if (reduced) {
		items.forEach((item) => item.classList.add("is-visible"));
		return;
	}
	const revealer = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) return;
				entry.target.classList.add("is-visible");
				revealer.unobserve(entry.target);
			});
		},
		{ rootMargin: "0px 0px -10% 0px", threshold: 0.15 }
	);
	items.forEach((item, index) => {
		item.style.transitionDelay = `${(index % 4) * 90}ms`;
		revealer.observe(item);
	});
})();
