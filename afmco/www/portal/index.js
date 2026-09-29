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
