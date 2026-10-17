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

	const stage = root.querySelector(".afm-stage[aria-roledescription]");
	const controls = stage && stage.querySelector(".afm-stage__controls");
	if (controls) {
		const pics = stage.querySelectorAll(".afm-stage__pic");
		const headlines = stage.querySelectorAll(".afm-stage__headline");
		const thumbs = stage.querySelectorAll(".afm-thumb");
		const count = stage.querySelector("[data-count]");
		const timer = stage.querySelector(".afm-timer");
		const pause = stage.querySelector("[data-pause]");
		const rtl = root.dir === "rtl";
		const total = pics.length;
		let current = 0;

		const render = (index) => {
			current = index;
			pics.forEach((pic, i) => pic.classList.toggle("is-current", i === index));
			headlines.forEach((headline, i) => {
				headline.classList.toggle("is-current", i === index);
				headline.hidden = i !== index;
			});
			thumbs.forEach((thumb, i) => thumb.setAttribute("aria-current", String(i === index)));
			count.textContent = String(index + 1).padStart(2, "0");
		};
		const restart = () => {
			timer.classList.remove("is-running");
			if (reduced) return;
			void timer.offsetWidth;
			timer.classList.add("is-running");
		};
		const go = (index, back) => {
			const next = (index + total) % total;
			if (next === current) return;
			document.documentElement.dataset.afmVt = back ? "back" : "next";
			if (document.startViewTransition && !reduced) document.startViewTransition(() => render(next));
			else render(next);
			restart();
		};
		const hold = (on) => stage.classList.toggle("is-holding", on);

		timer.addEventListener("animationend", () => go(current + 1, false));
		stage.querySelectorAll("[data-step]").forEach((button) => {
			const step = Number(button.dataset.step);
			button.addEventListener("click", () => go(current + step, step < 0));
		});
		thumbs.forEach((thumb, i) => thumb.addEventListener("click", () => go(i, i < current)));
		pause.addEventListener("click", () => {
			const paused = stage.classList.toggle("is-paused");
			pause.setAttribute("aria-label", paused ? stage.dataset.labelPlay : stage.dataset.labelPause);
			pause.querySelector("path").setAttribute("d", paused ? "M8 5l11 7-11 7z" : "M9 6v12M15 6v12");
		});
		stage.addEventListener("pointerenter", (event) => hold(event.pointerType === "mouse"));
		stage.addEventListener("pointerleave", () => hold(false));
		stage.addEventListener("focusin", () => hold(true));
		stage.addEventListener("focusout", (event) => {
			if (!stage.contains(event.relatedTarget)) hold(false);
		});
		stage.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			const forward = (event.key === "ArrowLeft") === rtl;
			go(current + (forward ? 1 : -1), !forward);
		});
		document.addEventListener("visibilitychange", () => {
			stage.classList.toggle("is-away", document.visibilityState !== "visible");
		});

		timer.hidden = reduced;
		pause.hidden = reduced;
		controls.hidden = false;
		stage.querySelector(".afm-thumbs").hidden = false;
		restart();
	}

	const reel = root.querySelector(".afm-reel__track");
	const dots = root.querySelector(".afm-reel__dots");
	if (reel && dots && !(window.CSS && CSS.supports("selector(::scroll-marker)"))) {
		const cards = [...reel.children];
		cards.forEach(() => dots.append(document.createElement("span")));
		const sync = () => {
			const step = cards[0].offsetWidth + (parseFloat(getComputedStyle(reel).columnGap) || 0);
			const index = Math.min(cards.length - 1, Math.round(Math.abs(reel.scrollLeft) / step));
			[...dots.children].forEach((dot, i) => dot.setAttribute("aria-current", String(i === index)));
		};
		reel.addEventListener("scroll", sync, { passive: true });
		sync();
	}

	if (!observable) {
		root.classList.add("afm--solid");
		root.querySelectorAll("[data-reveal]").forEach((item) => item.classList.add("is-visible"));
		return;
	}

	if (hero) {
		new IntersectionObserver(
			([entry]) => root.classList.toggle("afm--solid", !entry.isIntersecting),
			{ rootMargin: "-72px 0px 0px 0px" }
		).observe(hero);
	}

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
