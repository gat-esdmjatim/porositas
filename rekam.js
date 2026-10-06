/*
 * rekam.js : perekam rapat POROSITAS di halaman pembungkus (porositas.akuifera.id).
 * Aplikasi Apps Script berjalan di bingkai Google yang tidak meneruskan izin mikrofon,
 * jadi perekaman dilakukan di sini (halaman utama) dan setiap potongan audio dikirim
 * ke aplikasi lewat postMessage. Rekaman dipotong otomatis sesuai permintaan aplikasi
 * (bawaan 10 menit) dan terus berjalan sampai aplikasi mengirim perintah selesai.
 */
(function () {
  'use strict';
  var R = null;

  function asalSah(o) {
    // bingkai Apps Script: https://n-xxxx-0lu-script.googleusercontent.com (kadang dengan subdomain tambahan)
    return /^https:\/\/([a-z0-9-]+\.)*[a-z0-9-]*script\.googleusercontent\.com$/.test(String(o || '')) || /^https:\/\/script\.google\.com$/.test(String(o || ''));
  }
  function mimeRekam() {
    if (typeof MediaRecorder === 'undefined') return '';
    var daftar = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < daftar.length; i++) if (MediaRecorder.isTypeSupported(daftar[i])) return daftar[i];
    return '';
  }
  function kirim(src, org, d) {
    d.porositas = 'rekam';
    try { src.postMessage(d, org); } catch (e) { /* bingkai aplikasi sudah ditutup */ }
  }
  function kunciLayar() {
    try { if (navigator.wakeLock && R) navigator.wakeLock.request('screen').then(function (w) { if (R) R.wake = w; }, function () {}); } catch (e) { /* tidak didukung */ }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && R) kunciLayar(); });
  window.addEventListener('beforeunload', function (e) { if (R) { e.preventDefault(); e.returnValue = ''; } });

  function potonganBaru() {
    var r = R, no = ++r.no, isi = [];
    var rec = new MediaRecorder(r.stream, { mimeType: r.mime, audioBitsPerSecond: 32000 });
    rec.ondataavailable = function (e) { if (e.data && e.data.size) isi.push(e.data); };
    rec.onstop = function () {
      var akhir = r.berhenti && r.rec === rec;
      kirim(r.src, r.org, { ev: 'bagian', no: no, blob: new Blob(isi, { type: r.mime.split(';')[0] }), mime: r.mime, akhir: akhir });
      if (akhir) bersih(r);
    };
    rec.start(1000);
    r.rec = rec; r.potMulai = Date.now(); r.potJeda = 0;
  }
  function detak() {
    if (!R || R.jeda || R.berhenti) return;
    if ((Date.now() - R.potMulai - R.potJeda) / 1000 >= R.potong) {
      var lama = R.rec;
      potonganBaru();
      lama.stop();
    }
  }
  /* Keras suara dikirim 10 kali per detik untuk gelombang di aplikasi: 0 (sunyi, -60 dB) sampai 1 (0 dB). */
  function pengukur(r) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      r.ac = new AC();
      var an = r.ac.createAnalyser();
      an.fftSize = 1024;
      r.ac.createMediaStreamSource(r.stream).connect(an);
      var buf = new Float32Array(an.fftSize);
      if (r.ac.state === 'suspended' && r.ac.resume) r.ac.resume();
      r.ukur = setInterval(function () {
        an.getFloatTimeDomainData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        var db = 20 * Math.log10(Math.max(Math.sqrt(sum / buf.length), 1e-6));
        kirim(r.src, r.org, { ev: 'level', v: r.jeda ? 0 : Math.max(0, Math.min(1, (db + 60) / 60)) });
      }, 100);
    } catch (e) { /* tanpa Web Audio: rekaman tetap jalan, gelombang tidak tampil */ }
  }
  function bersih(r) {
    clearInterval(r.timer);
    clearInterval(r.ukur);
    try { if (r.ac) r.ac.close(); } catch (e) { /* abaikan */ }
    r.stream.getTracks().forEach(function (t) { t.stop(); });
    try { if (r.wake) r.wake.release(); } catch (e) { /* abaikan */ }
    if (R === r) R = null;
  }
  function mulai(src, org, potong) {
    if (R) { kirim(src, org, { ev: 'gagal', pesan: 'Perekaman lain masih berjalan.' }); return; }
    var mime = mimeRekam();
    if (!mime || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      kirim(src, org, { ev: 'gagal', pesan: 'Peramban ini tidak mendukung perekaman suara. Gunakan Chrome, Edge, atau Safari terbaru.' });
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }).then(function (stream) {
      R = { src: src, org: org, stream: stream, mime: mime, potong: Math.max(5, Math.min(1200, potong || 600)), no: 0, jeda: false, jedaSejak: 0, berhenti: false };
      pengukur(R);
      potonganBaru();
      R.timer = setInterval(detak, 1000);
      kunciLayar();
      kirim(src, org, { ev: 'mulai', mime: mime });
    }, function (err) {
      var n = err && err.name;
      kirim(src, org, { ev: 'gagal', pesan: n === 'NotAllowedError' ? 'Izin mikrofon ditolak. Izinkan mikrofon untuk situs ini lewat ikon gembok di bilah alamat, lalu coba lagi.'
        : n === 'NotFoundError' ? 'Mikrofon tidak ditemukan di perangkat ini.' : 'Mikrofon tidak dapat dibuka (' + (err && err.message ? err.message : n) + ').' });
    });
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.porositas !== 'rekam' || !d.cmd || !asalSah(e.origin)) return;
    if (d.cmd === 'cek') { kirim(e.source, e.origin, { ev: 'siap', mime: mimeRekam(), sedang: !!R }); return; }
    if (d.cmd === 'mulai') { mulai(e.source, e.origin, +d.potong); return; }
    if (!R || R.berhenti) return;
    if (d.cmd === 'jeda' && !R.jeda) { R.rec.pause(); R.jeda = true; R.jedaSejak = Date.now(); }
    else if (d.cmd === 'lanjut' && R.jeda) { R.rec.resume(); R.jeda = false; R.potJeda += Date.now() - R.jedaSejak; }
    else if (d.cmd === 'selesai') {
      if (R.jeda) { R.rec.resume(); R.jeda = false; }
      R.berhenti = true;
      R.rec.stop();
    }
  });
})();
