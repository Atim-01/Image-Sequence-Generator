/**
 * Scrub timeline: play frames → brief freeze for captions → resume.
 * Most of the scroll distance is motion so the sequence stays dense and smooth.
 */
export function createHeroTimeline({
  gsap,
  ScrollTrigger,
  state,
  lastFrame,
  captions,
  hint,
  onFrame,
}) {
  gsap.registerPlugin(ScrollTrigger);
  gsap.ticker.lagSmoothing(0);

  const mid = Math.round(lastFrame * 0.5);
  const introEnd = Math.round(lastFrame * 0.22);
  const [captionA, captionB] = captions;

  gsap.set(captions, { opacity: 0, y: 18 });
  gsap.set(hint, { opacity: 1 });

  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: "#hero",
      start: "top top",
      end: () => `+=${Math.round(window.innerHeight * 3.25)}`,
      pin: true,
      anticipatePin: 1,
      fastScrollEnd: true,
      scrub: 0.15,
      invalidateOnRefresh: true,
    },
    onUpdate: () => onFrame(state.frame),
  });

  tl.to(hint, { opacity: 0, duration: 0.25 }, 0);

  tl.to(state, { frame: introEnd, duration: 3.2 });

  if (captionA && captionA.textContent.trim()) {
    tl.to(captionA, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" });
    tl.to({}, { duration: 0.55 });
    tl.to(captionA, { opacity: 0, y: -12, duration: 0.35, ease: "power2.in" });
  }

  tl.to(state, { frame: mid, duration: 3 });

  if (captionB && captionB.textContent.trim()) {
    tl.to(captionB, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" });
    tl.to({}, { duration: 0.55 });
    tl.to(captionB, { opacity: 0, y: -12, duration: 0.35, ease: "power2.in" });
  }

  tl.to(state, { frame: lastFrame, duration: 3.4 });

  return tl;
}
