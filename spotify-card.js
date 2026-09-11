// Spotify player card — sits in the detail overlay's side column.
// Vanilla port of a React/shadcn component: same interactions (play/pause,
// draggable progress + volume, like, context menu, hover glow), no React/
// Tailwind/build step, because this site has none — see README for why.
// Playback is a visual mock, same as the source component; the one real
// action is "open in Spotify", which follows item.spotify from the catalogue.
(function () {
  "use strict";

  var ICONS = {
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    skipBack: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
    skipForward: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  };

  function icon(name, extraAttrs) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (extraAttrs || "") +
      ">" +
      ICONS[name] +
      "</svg>"
    );
  }

  function formatTime(seconds) {
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return mins + ":" + String(secs).padStart(2, "0");
  }

  function clampPercent(n) {
    return Math.max(0, Math.min(100, n));
  }

  function create(container, handlers) {
    handlers = handlers || {};

    container.innerHTML =
      '<div class="spotify-card" tabindex="-1">' +
      '  <div class="sc-top">' +
      '    <div class="sc-head">' +
      '      <div class="sc-brand">' +
      '        <div class="sc-mark">' +
      '          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>' +
      "        </div>" +
      '        <div class="sc-brand-text">' +
      '          <span class="sc-wordmark-wrap" style="position:relative;display:inline-block">' +
      '            <span class="sc-wordmark-plain">Spotify</span>' +
      '            <span class="sc-wordmark-static" aria-hidden="true">Spotify</span>' +
      "          </span>" +
      '          <div class="sc-tagline">Premium Experience</div>' +
      "        </div>" +
      "      </div>" +
      '      <a class="sc-open" href="#" target="_blank" rel="noreferrer" aria-label="Open in Spotify">' +
      icon("chevronRight") +
      "      </a>" +
      "    </div>" +
      '    <p class="sc-copy">Search for music and podcasts, browse your library, and control playback.</p>' +
      '    <div class="sc-rule"></div>' +
      "  </div>" +
      '  <div class="sc-art">' +
      '    <img class="sc-art-img" src="" alt="" />' +
      '    <div class="sc-art-scrim">' +
      '      <button type="button" class="sc-play-big" aria-label="Play preview">' +
      icon("play", ' class="sc-icon-play"') +
      icon("pause", ' class="sc-icon-pause" style="display:none"') +
      "      </button>" +
      '      <div class="sc-art-actions">' +
      '        <button type="button" class="sc-chip sc-like" aria-label="Like">' +
      icon("heart") +
      "        </button>" +
      '        <button type="button" class="sc-chip sc-add" aria-label="Add to playlist">' +
      icon("plus") +
      "        </button>" +
      '        <button type="button" class="sc-chip sc-more" aria-label="More options" aria-haspopup="true" aria-expanded="false">' +
      icon("more") +
      "        </button>" +
      "      </div>" +
      "    </div>" +
      '    <div class="sc-menu" hidden>' +
      '      <button type="button" class="sc-menu-like">' +
      icon("heart") +
      '        <span class="sc-menu-like-label">Add to Liked</span>' +
      "      </button>" +
      '      <button type="button">' + icon("plus") + "<span>Add to playlist</span></button>" +
      '      <div class="sc-menu-rule"></div>' +
      '      <button type="button" class="sc-menu-next">' + icon("skipForward") + "<span>Next in queue</span></button>" +
      '      <button type="button" class="sc-menu-prev">' + icon("skipBack") + "<span>Previous in queue</span></button>" +
      "    </div>" +
      "  </div>" +
      '  <div class="sc-equalizer" hidden>' +
      "<span></span><span></span><span></span><span></span><span></span>" +
      "  </div>" +
      '  <div class="sc-player">' +
      '    <div class="sc-progress"><div class="sc-progress-fill"></div></div>' +
      '    <div class="sc-track-row">' +
      "      <div>" +
      '        <div class="sc-track-title"></div>' +
      '        <div class="sc-track-artist"></div>' +
      "      </div>" +
      '      <div class="sc-time"></div>' +
      "    </div>" +
      '    <div class="sc-controls">' +
      '      <div class="sc-transport">' +
      '        <button type="button" class="sc-btn-round sc-prev" aria-label="Previous piece">' + icon("skipBack") + "</button>" +
      '        <button type="button" class="sc-play" aria-label="Play preview">' +
      icon("play", ' class="sc-icon-play2"') +
      icon("pause", ' class="sc-icon-pause2" style="display:none"') +
      "        </button>" +
      '        <button type="button" class="sc-btn-round sc-next" aria-label="Next piece">' + icon("skipForward") + "</button>" +
      "      </div>" +
      '      <div class="sc-volume">' +
      '        <button type="button" class="sc-volume-btn" aria-label="Mute">' + icon("volume") + "</button>" +
      '        <div class="sc-volume-track"><div class="sc-volume-fill"></div><div class="sc-volume-knob"></div></div>' +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      '  <div class="sc-ring"></div>' +
      '  <div class="sc-foot-glow"></div>' +
      "</div>";

    var el = container.querySelector(".spotify-card");
    var progressBar = el.querySelector(".sc-progress");
    var progressFill = el.querySelector(".sc-progress-fill");
    var volumeTrack = el.querySelector(".sc-volume-track");
    var volumeFill = el.querySelector(".sc-volume-fill");
    var timeEl = el.querySelector(".sc-time");
    var titleEl = el.querySelector(".sc-track-title");
    var artistEl = el.querySelector(".sc-track-artist");
    var artImg = el.querySelector(".sc-art-img");
    var openLink = el.querySelector(".sc-open");
    var equalizer = el.querySelector(".sc-equalizer");
    var menu = el.querySelector(".sc-menu");
    var menuLikeLabel = menu.querySelector(".sc-menu-like-label");
    var moreBtn = el.querySelector(".sc-more");

    // The card clips its own corners with overflow:hidden, so the dropdown
    // is detached to <body> and positioned against the trigger button —
    // otherwise it gets cropped by that clip.
    document.body.appendChild(menu);

    var playBtns = [el.querySelector(".sc-play-big"), el.querySelector(".sc-play")];
    var playIcons = [
      { play: el.querySelector(".sc-icon-play"), pause: el.querySelector(".sc-icon-pause") },
      { play: el.querySelector(".sc-icon-play2"), pause: el.querySelector(".sc-icon-pause2") },
    ];

    var state = {
      song: null,
      isPlaying: false,
      progress: 0, // 0-100
      volume: 75,
      liked: false,
      draggingProgress: false,
      draggingVolume: false,
      tickId: null,
    };

    function setHovered(on) {
      el.classList.toggle("is-hovered", on);
    }
    el.addEventListener("mouseenter", function () {
      setHovered(true);
    });
    el.addEventListener("mouseleave", function () {
      setHovered(false);
    });
    el.addEventListener("mousemove", function (event) {
      var rect = el.getBoundingClientRect();
      var x = ((event.clientX - rect.left) / rect.width) * 100;
      var y = ((event.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty("--sc-mx", x + "%");
      el.style.setProperty("--sc-my", y + "%");
    });

    function renderPlayState() {
      playIcons.forEach(function (pair) {
        pair.play.style.display = state.isPlaying ? "none" : "";
        pair.pause.style.display = state.isPlaying ? "" : "none";
      });
      equalizer.hidden = !state.isPlaying;
    }

    function renderProgress() {
      progressFill.style.width = state.progress + "%";
      if (state.song) {
        var current = (state.progress / 100) * state.song.duration;
        timeEl.textContent = formatTime(current) + " / " + formatTime(state.song.duration);
      }
    }

    function renderVolume() {
      volumeFill.style.width = state.volume + "%";
      volumeTrack.querySelector(".sc-volume-knob").style.left = state.volume + "%";
    }

    function stopTick() {
      if (state.tickId) {
        clearInterval(state.tickId);
        state.tickId = null;
      }
    }

    function startTick() {
      stopTick();
      if (!state.song) return;
      var stepPerTick = 100 / (state.song.duration * 10); // 100ms tick
      state.tickId = setInterval(function () {
        if (state.draggingProgress) return;
        state.progress = Math.min(100, state.progress + stepPerTick);
        renderProgress();
        if (state.progress >= 100) {
          state.isPlaying = false;
          stopTick();
          renderPlayState();
        }
      }, 100);
    }

    function togglePlay() {
      state.isPlaying = !state.isPlaying;
      if (state.progress >= 100) state.progress = 0;
      renderPlayState();
      if (state.isPlaying) startTick();
      else stopTick();
    }

    playBtns.forEach(function (btn) {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        togglePlay();
      });
    });

    function seekFromEvent(event, track) {
      var rect = track.getBoundingClientRect();
      var pct = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
      return pct;
    }

    progressBar.addEventListener("mousedown", function (event) {
      state.draggingProgress = true;
      state.progress = seekFromEvent(event, progressBar);
      renderProgress();
      function onMove(e) {
        state.progress = seekFromEvent(e, progressBar);
        renderProgress();
      }
      function onUp() {
        state.draggingProgress = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    volumeTrack.addEventListener("mousedown", function (event) {
      state.draggingVolume = true;
      volumeTrack.classList.add("is-dragging");
      state.volume = seekFromEvent(event, volumeTrack);
      renderVolume();
      function onMove(e) {
        state.volume = seekFromEvent(e, volumeTrack);
        renderVolume();
      }
      function onUp() {
        state.draggingVolume = false;
        volumeTrack.classList.remove("is-dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    function setLiked(on) {
      state.liked = on;
      [el.querySelector(".sc-like"), menu.querySelector(".sc-menu-like")].forEach(function (btn) {
        btn.classList.toggle("is-liked", on);
        var svg = btn.querySelector("svg");
        svg.setAttribute("fill", on ? "#1ED760" : "none");
      });
      menuLikeLabel.textContent = on ? "Remove from Liked" : "Add to Liked";
    }

    el.querySelector(".sc-like").addEventListener("click", function (event) {
      event.stopPropagation();
      setLiked(!state.liked);
    });
    menu.querySelector(".sc-menu-like").addEventListener("click", function () {
      setLiked(!state.liked);
    });

    function openMenu() {
      var rect = moreBtn.getBoundingClientRect();
      menu.style.top = rect.bottom + 8 + "px";
      menu.style.left = Math.max(8, rect.right - 200) + "px";
      menu.hidden = false;
      moreBtn.setAttribute("aria-expanded", "true");
    }
    function closeMenu() {
      menu.hidden = true;
      moreBtn.setAttribute("aria-expanded", "false");
    }
    moreBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });
    document.addEventListener("mousedown", function (event) {
      if (!menu.hidden && !el.contains(event.target) && !menu.contains(event.target)) closeMenu();
    });

    function goNext() {
      closeMenu();
      if (typeof handlers.onNext === "function") handlers.onNext();
    }
    function goPrev() {
      closeMenu();
      if (typeof handlers.onPrev === "function") handlers.onPrev();
    }
    el.querySelector(".sc-prev").addEventListener("click", function (event) {
      event.stopPropagation();
      goPrev();
    });
    el.querySelector(".sc-next").addEventListener("click", function (event) {
      event.stopPropagation();
      goNext();
    });
    menu.querySelector(".sc-menu-next").addEventListener("click", goNext);
    menu.querySelector(".sc-menu-prev").addEventListener("click", goPrev);

    function update(song) {
      state.song = song;
      state.isPlaying = false;
      state.progress = 0;
      stopTick();
      renderPlayState();
      renderProgress();
      titleEl.textContent = song.title;
      artistEl.textContent = song.artist;
      artImg.src = song.albumArt;
      artImg.alt = song.title + " cover art";
      openLink.href = song.spotify || "https://open.spotify.com/search/" + encodeURIComponent(song.title + " " + song.artist);
      closeMenu();
    }

    renderVolume();

    return {
      update: update,
      destroy: function () {
        stopTick();
      },
    };
  }

  window.XSTSpotifyCard = { create: create };
})();
