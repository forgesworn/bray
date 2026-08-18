/*
 * Motion for bray.forgesworn.dev.
 *
 * Everything here is an enhancement layered on top of a page that already
 * works without it. The inline script at the end of the document owns the
 * baseline reveal (an IntersectionObserver that adds `.visible`); if this
 * file or its vendored anime.js fails to load, that baseline still runs and
 * nothing is left hidden.
 *
 * Three jobs the CSS cannot do on its own:
 *   1. counting the hero stats up from zero
 *   2. cascading the 16-card tool grid, where the CSS delay ladder runs out
 *      at thirteen and the last three cards land with no delay at all
 *   3. filling the accent rail on each trust card as it arrives
 *
 * Load order matters: this runs before the inline script so that job 2 can
 * claim its container before the observer sees it.
 */
(function () {
  'use strict';

  if (!window.anime) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var animate = anime.animate;
  var stagger = anime.stagger;
  var onScroll = anime.onScroll;

  // Play an animation once, the first time its target scrolls into view, then
  // leave it alone.
  //
  // The animation is deliberately NOT handed to the observer as `autoplay`.
  // A scroll-linked animation is paused by anime when its target leaves the
  // viewport, so scrolling past a section at reading speed strands the
  // cascade at whatever opacity each card had reached and it never recovers.
  // Triggering playback and then letting the animation run on its own clock
  // is the difference between "reveals as you arrive" and "half the grid is
  // permanently at 60% opacity".
  //
  // Enter when the target's top has risen 60px above the viewport's bottom
  // edge, so a section is committed to being on screen before it starts.
  function playOnceInView(target, animation) {
    onScroll({
      target: target,
      enter: { target: 'top', container: 'bottom-=60' },
      repeat: false,
      onEnter: function () { animation.play(); }
    });
  }

  /* ---------------------------------------------------------------
     1. Hero stats
     Read out of the DOM rather than hardcoded, so the tool and group counts
     stay correct when the markup is updated. "0 accounts needed" counts from
     zero to zero, which is exactly the right amount of drama for that one.
     --------------------------------------------------------------- */
  function countUp() {
    document.querySelectorAll('.hero-stats .stat-value').forEach(function (el, i) {
      var target = parseInt(el.textContent.trim(), 10);
      if (!isFinite(target)) return;
      var counter = { n: 0 };
      el.textContent = '0';
      animate(counter, {
        n: target,
        duration: 1400,
        delay: 260 + i * 90,
        ease: 'out(3)',
        onUpdate: function () { el.textContent = String(Math.round(counter.n)); },
        // Land exactly on the real number rather than a rounded tween.
        onComplete: function () { el.textContent = String(target); }
      });
    });
  }

  /* ---------------------------------------------------------------
     2. Long grids
     The CSS ladder for .reveal-stagger stops at :nth-child(13). The tool grid
     holds sixteen cards, so the last three arrive with no delay and break the
     cascade. Containers longer than the ladder are claimed here; shorter ones
     are left to the CSS, which already handles them correctly.
     --------------------------------------------------------------- */
  var CSS_LADDER_LENGTH = 13;

  function cascadeLongGrids() {
    document.querySelectorAll('.reveal-stagger').forEach(function (grid) {
      var children = Array.prototype.slice.call(grid.children);

      // Absolutely positioned children are overlays drawn on top of a grid
      // rather than cells laid out in it. Sliding them with the cards would
      // pull them off whatever they are aligned to.
      var cards = children.filter(function (el) {
        return getComputedStyle(el).position !== 'absolute';
      });
      var overlays = children.filter(function (el) { return cards.indexOf(el) === -1; });

      if (cards.length <= CSS_LADDER_LENGTH) return;

      // Taking the class off keeps the inline script's observer away from
      // this container, so the two never animate the same cards.
      grid.classList.remove('reveal-stagger');
      grid.classList.add('motion-cascade');

      // .motion-cascade hides every child. Anything not in the cascade has to
      // be handed back its visibility here, or it stays hidden for good.
      overlays.forEach(function (el) {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });

      playOnceInView(grid, animate(cards, {
        opacity: [0, 1],
        y: [16, 0],
        duration: 620,
        delay: stagger(45),
        ease: 'out(3)',
        autoplay: false
      }));
    });
  }

  /* ---------------------------------------------------------------
     3. Trust card rails
     Each trust card carries a 3px accent bar down its left edge. Filling it
     from the top as the card arrives makes the three questions read as three
     separate measures rather than three paragraphs.

     The starting state is set from here rather than from CSS, so a page
     without this file keeps its rails at full height.
     --------------------------------------------------------------- */
  function fillTrustRails() {
    var grids = document.querySelectorAll('.trust-grid');
    if (!grids.length) return;

    grids.forEach(function (grid) {
      var rails = [];
      grid.querySelectorAll('.trust-card').forEach(function (card) {
        // The rail is the thin absolutely positioned bar, not the icon or
        // any other overlay a card might pick up later.
        var bar = Array.prototype.slice.call(card.children).filter(function (el) {
          var cs = getComputedStyle(el);
          return cs.position === 'absolute' && parseFloat(cs.width) <= 6;
        })[0];
        if (bar) rails.push(bar);
      });
      if (!rails.length) return;

      rails.forEach(function (bar) {
        bar.style.transformOrigin = 'top center';
        bar.style.transform = 'scaleY(0)';
      });

      playOnceInView(grid, animate(rails, {
        scaleY: [0, 1],
        duration: 760,
        delay: stagger(120, { start: 180 }),
        ease: 'out(3)',
        autoplay: false
      }));
    });
  }

  cascadeLongGrids();
  countUp();
  fillTrustRails();
})();
