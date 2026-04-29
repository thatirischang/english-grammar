// Single-instance audio player.
// Each .play button has data-audio="..." pointing at an MP3 file.
// Clicking plays it; clicking again (or another button) stops the previous.
(function () {
  let audio = null;
  let activeBtn = null;

  function stop() {
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio = null;
    }
    if (activeBtn) {
      activeBtn.classList.remove("playing");
      activeBtn.textContent = "▶";
      activeBtn = null;
    }
  }

  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".play");
    if (!btn) return;
    e.preventDefault();
    if (btn === activeBtn) {
      stop();
      return;
    }
    stop();
    const src = btn.getAttribute("data-audio");
    if (!src) return;
    audio = new Audio(src);
    activeBtn = btn;
    btn.classList.add("playing");
    btn.textContent = "■";
    audio.addEventListener("ended", stop);
    audio.addEventListener("error", stop);
    audio.play().catch(stop);
  });
})();
