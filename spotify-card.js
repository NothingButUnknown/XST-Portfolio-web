// Spotify player card — sits in the detail overlay's side column.
// Vanilla port of a React/shadcn component: same interactions (play/pause,
// draggable progress + volume, like, context menu, hover glow), no React/
// Tailwind/build step, because this site has none — see README for why.
//
// Playback: tracks with a resolved catalogue[i].spotifyId play for real,
// through Spotify's own iFrame Playback API — a controller loaded into the
// off-canvas #spotifyEmbedHost div (see index.html) that this card drives
// with its own play/pause/seek buttons instead of showing Spotify's player
// chrome. Tracks without a spotifyId have no audio to load; the card falls
// back to the old visual-only mock so the UI still has something to show,
// and "open in Spotify" (item.spotify) is the only real action for those.
(function () {
  "use strict";

  // ---- shared embed controller (one per page; cards come and go) ----
  var EMBED = (window.__xstSpotifyEmbed = window.__xstSpotifyEmbed || {
    controller: null,
    ready: false,
    pendingUri: null,
    listeners: [],
  });

  if (!window.onSpotifyIframeApiReady) {
    window.onSpotifyIframeApiReady = function (IFrameAPI) {
      var host = document.getElementById("spotifyEmbedHost");
      if (!host) return;
      IFrameAPI.createController(
        host,
        // Bootstrap URI just needs to be a valid track so the controller
        // initializes; the first real update() call swaps it via loadUri.
        { uri: "spotify:track:1uxXUkZoFOG1ogg2oHcmUl", width: "300", height: "80" },
        function (controller) {
          EMBED.controller = controller;
          EMBED.ready = true;
          if (EMBED.pendingUri) {
            controller.loadUri(EMBED.pendingUri);
            EMBED.pendingUri = null;
          }
          controller.addListener("playback_update", function (event) {
            EMBED.listeners.forEach(function (fn) {
              fn(event.data);
            });
          });
        }
      );
    };
  }

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

  // ---- persistent scroll-following mini-player ----
  // The full card only exists inside the detail overlay, so closing that
  // overlay used to make a playing track vanish from view entirely — audio
  // kept going through the invisible embed host with nothing on screen to
  // show or control it. This is the visible, playback-only substitute.
  //
  // It's mounted into #miniPlayerTrack (the whole page body, footer
  // included), not fixed to the viewport — position:sticky there means it
  // rides along the full scroll and settles at the true bottom of the page
  // over the footer, instead of stopping at the footer's top edge. The
  // slot it sits in is height:0 so the sticky box itself adds no extra
  // scroll space to the page; only the pill inside it is visible.
  var MINI = null;

  function isDetailOverlayOpen() {
    var overlay = document.getElementById("detailOverlay");
    return !!overlay && overlay.classList.contains("is-open");
  }

  function ensureMiniPlayer() {
    if (MINI) return MINI;

    var track = document.getElementById("miniPlayerTrack") || document.body;

    var slot = document.createElement("div");
    slot.className = "sc-mini-slot";
    track.appendChild(slot);

    var el = document.createElement("div");
    el.className = "sc-mini";
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-label", "Now playing — reopen");
    el.innerHTML =
      '<button type="button" class="sc-mini-play" aria-label="Pause">' +
      icon("play", ' class="sc-mini-icon-play" style="display:none"') +
      icon("pause", ' class="sc-mini-icon-pause"') +
      "</button>" +
      '<img class="sc-mini-art" src="" alt="" />' +
      '<div class="sc-mini-meta">' +
      '  <div class="sc-mini-title"></div>' +
      '  <div class="sc-mini-artist"></div>' +
      "</div>" +
      '<div class="sc-mini-progress"><div class="sc-mini-progress-fill"></div></div>';
    slot.appendChild(el);

    var artImg = el.querySelector(".sc-mini-art");
    var titleEl = el.querySelector(".sc-mini-title");
    var artistEl = el.querySelector(".sc-mini-artist");
    var fill = el.querySelector(".sc-mini-progress-fill");
    var playBtn = el.querySelector(".sc-mini-play");
    var playIcon = el.querySelector(".sc-mini-icon-play");
    var pauseIcon = el.querySelector(".sc-mini-icon-pause");

    function updateVisibility() {
      var show = !!EMBED.isPlaying && !isDetailOverlayOpen();
      el.classList.toggle("is-visible", show);
    }

    function expand() {
      if (typeof EMBED.reopenDetail === "function") EMBED.reopenDetail();
    }

    playBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      if (EMBED.ready && EMBED.controller) EMBED.controller.togglePlay();
    });
    el.addEventListener("click", expand);
    el.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        expand();
      }
    });

    // The overlay opening/closing is the other trigger for hiding or
    // revealing this — not just play state — so watch it directly instead
    // of threading overlay events through every card instance.
    var overlayNode = document.getElementById("detailOverlay");
    if (overlayNode) {
      new MutationObserver(updateVisibility).observe(overlayNode, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    MINI = {
      setTrack: function (song) {
        artImg.src = song.albumArt;
        artImg.alt = song.title + " cover art";
        titleEl.textContent = song.title;
        artistEl.textContent = song.artist;
      },
      setPlaying: function (isPlaying) {
        EMBED.isPlaying = isPlaying;
        playIcon.style.display = isPlaying ? "none" : "";
        pauseIcon.style.display = isPlaying ? "" : "none";
        playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
        updateVisibility();
      },
      setProgress: function (pct) {
        fill.style.width = pct + "%";
      },
    };

    return MINI;
  }

  // One listener for the whole page (not per-card) keeps the mini-player in
  // sync with whichever track is actually loaded in the shared controller.
  EMBED.listeners.push(function (data) {
    if (!EMBED.nowPlayingUri || data.playingURI !== EMBED.nowPlayingUri) return;
    var mini = ensureMiniPlayer();
    mini.setPlaying(!data.isPaused);
    if (data.duration) {
      mini.setProgress(clampPercent((data.position / data.duration) * 100));
    }
  });

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
      hasAudio: false, // true when the current song has a real spotifyId
      spotifyUri: null,
      realDuration: 0, // seconds, from Spotify once it reports one
      realPosition: 0, // seconds
    };

    // Real playback drives this card's UI from Spotify's own event stream
    // instead of the local fake-timer tick used for songs with no audio.
    function onPlaybackUpdate(data) {
      if (!state.hasAudio || data.playingURI !== state.spotifyUri) return;
      if (state.draggingProgress) return;
      state.isPlaying = !data.isPaused;
      if (data.duration) {
        state.realDuration = data.duration / 1000;
        state.realPosition = data.position / 1000;
        state.progress = clampPercent((state.realPosition / state.realDuration) * 100);
      }
      renderPlayState();
      renderProgress();
    }
    EMBED.listeners.push(onPlaybackUpdate);

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
      if (!state.song) return;
      if (state.hasAudio && state.realDuration) {
        timeEl.textContent = formatTime(state.realPosition) + " / " + formatTime(state.realDuration);
      } else {
        var current = (state.progress / 100) * state.song.duration;
        timeEl.textContent = formatTime(current) + " / " + formatTime(state.song.duration);
      }
    }

    function renderVolume() {
      volumeFill.style.width = state.volume + "%";
      volumeTrack.querySelector(".sc-volume-knob").style.left = state.volume + "%";
    }

    function togglePlay() {
      if (state.hasAudio) {
        // Real track: hand off to Spotify's controller and let the
        // playback_update listener above bring our UI back in sync —
        // it's the source of truth, not a local guess at play state.
        if (EMBED.ready && EMBED.controller) EMBED.controller.togglePlay();
        return;
      }
      // No resolved spotifyId — there is nothing here to actually play.
      // Used to fake it with a silent timer + bouncing equalizer; that
      // reads as broken (or a lie), not as "no preview yet". Send them to
      // the real thing instead.
      if (openLink.href) window.open(openLink.href, "_blank", "noopener");
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

    function setDragProgress(pct) {
      state.progress = pct;
      if (state.hasAudio && state.realDuration) {
        state.realPosition = (pct / 100) * state.realDuration;
      }
      renderProgress();
    }

    progressBar.addEventListener("mousedown", function (event) {
      if (!state.hasAudio) return; // nothing loaded to scrub
      state.draggingProgress = true;
      setDragProgress(seekFromEvent(event, progressBar));
      function onMove(e) {
        setDragProgress(seekFromEvent(e, progressBar));
      }
      function onUp() {
        state.draggingProgress = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // Real track: commit the scrub to Spotify's actual playhead. The
        // mock has nothing to seek — its fake tick just keeps counting up
        // from wherever the bar was dropped.
        if (state.hasAudio && EMBED.ready && EMBED.controller && state.realDuration) {
          EMBED.controller.seek(state.realPosition);
        }
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
        svg.setAttribute("fill", on ? "#ff2b1f" : "none");
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
      state.hasAudio = !!song.spotifyId;
      state.spotifyUri = state.hasAudio ? "spotify:track:" + song.spotifyId : null;
      state.realDuration = 0;
      state.realPosition = 0;
      renderPlayState();
      renderProgress();
      titleEl.textContent = song.title;
      artistEl.textContent = song.artist;
      artImg.src = song.albumArt;
      artImg.alt = song.title + " cover art";
      openLink.href = song.spotify || "https://open.spotify.com/search/" + encodeURIComponent(song.title + " " + song.artist);
      closeMenu();

      el.classList.toggle("no-preview", !state.hasAudio);
      var previewLabel = state.hasAudio ? "Play preview" : "Preview not available — open in Spotify";
      playBtns.forEach(function (btn) {
        btn.setAttribute("aria-label", previewLabel);
        btn.title = state.hasAudio ? "" : previewLabel;
      });

      if (state.hasAudio) {
        EMBED.nowPlayingUri = state.spotifyUri;
        EMBED.isPlaying = false; // reset until the next playback_update confirms it
        ensureMiniPlayer().setTrack(song);
        if (EMBED.ready && EMBED.controller) {
          EMBED.controller.loadUri(state.spotifyUri);
        } else {
          // API script hasn't called back yet — onSpotifyIframeApiReady
          // loads this as soon as the controller exists.
          EMBED.pendingUri = state.spotifyUri;
        }
      }
    }

    renderVolume();

    return {
      update: update,
      destroy: function () {
        var i = EMBED.listeners.indexOf(onPlaybackUpdate);
        if (i !== -1) EMBED.listeners.splice(i, 1);
      },
    };
  }

  window.XSTSpotifyCard = { create: create };
})();
