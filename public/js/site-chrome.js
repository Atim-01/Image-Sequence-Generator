export const FONTS = {
  cormorant: {
    label: "Cormorant Garamond",
    family: '"Cormorant Garamond", Georgia, serif',
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&display=swap",
  },
  playfair: {
    label: "Playfair Display",
    family: '"Playfair Display", Georgia, serif',
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400&family=Playfair+Display:ital,wght@0,500;1,500&display=swap",
  },
  fraunces: {
    label: "Fraunces",
    family: '"Fraunces", Georgia, serif',
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400&family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,500&display=swap",
  },
  libre: {
    label: "Libre Baskerville",
    family: '"Libre Baskerville", Georgia, serif',
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400&family=Libre+Baskerville:ital,wght@0,400;1,400&display=swap",
  },
  "dm-serif": {
    label: "DM Serif Display",
    family: '"DM Serif Display", Georgia, serif',
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400&family=DM+Serif+Display:ital@0;1&display=swap",
  },
  outfit: {
    label: "Outfit",
    family: '"Outfit", system-ui, sans-serif',
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500&display=swap",
  },
};

export const DEFAULT_COPY = {
  captionA: "Experience the Extraordinary.",
  captionB: "Designed to inspire your everyday.",
  after: "The sequence lives in the scroll. What comes next is yours.",
  hint: "Scroll",
  theme: "dark",
  font: "cormorant",
};

export function fontHref(fontId) {
  return (FONTS[fontId] ?? FONTS.cormorant).href;
}

export function fontFamily(fontId) {
  return (FONTS[fontId] ?? FONTS.cormorant).family;
}

function setCopy(el, text) {
  if (!el) return;
  const value = text == null ? "" : String(text);
  el.textContent = value;
  el.classList.toggle("is-empty", !value.trim());
}

export function applyChrome({
  theme = "dark",
  font = "cormorant",
  captionA,
  captionB,
  after,
  hint,
} = {}) {
  const root = document.documentElement;
  root.dataset.theme = theme === "light" ? "light" : "dark";
  root.style.setProperty("--display-font", fontFamily(font));

  const link = document.querySelector("[data-fonts]");
  if (link) link.href = fontHref(font);

  const lines = document.querySelectorAll(".hero__line");
  if (captionA !== undefined) setCopy(lines[0], captionA);
  if (captionB !== undefined) setCopy(lines[1], captionB);

  const afterSection = document.querySelector("#after");
  const afterEl = document.querySelector("#after p");
  if (after !== undefined) {
    setCopy(afterEl, after);
    afterSection?.classList.toggle("is-empty", !String(after).trim());
  }

  const hintEl = document.querySelector(".hero__hint");
  if (hint !== undefined) setCopy(hintEl, hint);
}

export function isStudioPreview() {
  return new URLSearchParams(location.search).get("studio") === "1";
}
