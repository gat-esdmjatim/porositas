/*
 * rekam.js : perekam rapat dan pencetak PDF POROSITAS di halaman pembungkus (porositas.akuifera.id).
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

  /*
   * Potongan baru dimulai saat potongan berjalan sudah berisi `potong` detik audio (dihitung dari event data
   * per detik, bukan dari timer, sehingga tetap tepat walau tab tidak aktif). Potongan lama dihentikan setelah
   * potongan baru menerima data pertama, jadi ada tumpang tindih sekitar 1 detik dan tidak ada kata yang hilang.
   */
  function potonganBaru() {
    var r = R, no = ++r.no, isi = [], detikIni = 0, lama = r.rec;
    var rec = new MediaRecorder(r.stream, { mimeType: r.mime, audioBitsPerSecond: 64000 });
    rec.ondataavailable = function (e) {
      if (e.data && e.data.size) isi.push(e.data);
      if (r.rec !== rec || r.berhenti) return;
      if (lama) { var l = lama; lama = null; try { if (l.state !== 'inactive') l.stop(); } catch (er) { /* abaikan */ } }
      detikIni++; r.detik++;
      kirim(r.src, r.org, { ev: 'detik', n: r.detik });
      if (detikIni >= r.potong && !r.jeda) potonganBaru();
    };
    rec.onstop = function () {
      var akhir = r.berhenti && r.rec === rec;
      kirim(r.src, r.org, { ev: 'bagian', no: no, blob: new Blob(isi, { type: r.mime.split(';')[0] }), mime: r.mime, akhir: akhir });
      if (akhir) bersih(r);
    };
    rec.onerror = function (e) { putus(r, 'Perekam berhenti karena galat (' + (e && e.error ? e.error.name : 'tidak diketahui') + ').'); };
    rec.start(1000);
    r.rec = rec;
  }
  function putus(r, pesan) {
    if (r.berhenti) return;
    kirim(r.src, r.org, { ev: 'putus', pesan: pesan, akhir: true });
    r.berhenti = true;
    try { if (r.rec.state !== 'inactive') r.rec.stop(); else bersih(r); } catch (e) { bersih(r); }
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
    // tanpa peredam gema/derau bawaan (dirancang untuk panggilan video, memotong suara peserta yang jauh dari mikrofon)
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } }).then(function (stream) {
      R = { src: src, org: org, stream: stream, mime: mime, potong: Math.max(5, Math.min(1200, potong || 600)), no: 0, detik: 0, jeda: false, berhenti: false };
      var trek = stream.getAudioTracks()[0], r0 = R;
      if (trek) {
        trek.onended = function () { putus(r0, 'Mikrofon terputus (perangkat dilepas atau izin dicabut). Bagian yang sudah terekam tetap diproses.'); };
        trek.onmute = function () { kirim(r0.src, r0.org, { ev: 'senyap', on: true }); };
        trek.onunmute = function () { kirim(r0.src, r0.org, { ev: 'senyap', on: false }); };
      }
      pengukur(R);
      potonganBaru();
      kunciLayar();
      kirim(src, org, { ev: 'mulai', mime: mime });
    }, function (err) {
      var n = err && err.name;
      kirim(src, org, { ev: 'gagal', pesan: n === 'NotAllowedError' ? 'Izin mikrofon ditolak. Izinkan mikrofon untuk situs ini lewat ikon gembok di bilah alamat, lalu coba lagi.'
        : n === 'NotFoundError' ? 'Mikrofon tidak ditemukan di perangkat ini.' : 'Mikrofon tidak dapat dibuka (' + (err && err.message ? err.message : n) + ').' });
    });
  }

  /* Cetak: bingkai Google tidak boleh menampilkan PDF, jadi PDF dicetak dari halaman ini lewat bingkai tersembunyi. */
  function cetak(src, org, d) {
    try {
      var url = URL.createObjectURL(d.blob), fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;opacity:0';
      fr.onload = function () {
        setTimeout(function () {
          try { fr.contentWindow.focus(); fr.contentWindow.print(); kirim(src, org, { ev: 'cetak-ok', kode: d.kode }); }
          catch (er) { kirim(src, org, { ev: 'cetak-gagal', kode: d.kode, pesan: String(er && er.message) }); }
        }, 400);
      };
      fr.src = url;
      document.body.appendChild(fr);
      setTimeout(function () { try { fr.remove(); URL.revokeObjectURL(url); } catch (er) { /* abaikan */ } }, 15 * 60 * 1000);
    } catch (e) { kirim(src, org, { ev: 'cetak-gagal', kode: d.kode, pesan: String(e && e.message) }); }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.porositas !== 'rekam' || !d.cmd || !asalSah(e.origin)) return;
    if (d.cmd === 'cek') { kirim(e.source, e.origin, { ev: 'siap', mime: mimeRekam(), sedang: !!R }); return; }
    if (d.cmd === 'cetak') { cetak(e.source, e.origin, d); return; }
    if (d.cmd === 'mulai') { mulai(e.source, e.origin, +d.potong); return; }
    if (!R || R.berhenti) return;
    if (d.cmd === 'jeda' && !R.jeda) { R.rec.pause(); R.jeda = true; }
    else if (d.cmd === 'lanjut' && R.jeda) { R.rec.resume(); R.jeda = false; }
    else if (d.cmd === 'selesai') {
      if (R.jeda) { R.rec.resume(); R.jeda = false; }
      R.berhenti = true;
      R.rec.stop();
    }
  });
})();
