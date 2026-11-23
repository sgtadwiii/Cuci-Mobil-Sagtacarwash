<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { supabase } from '../services/supabase'

const video = ref(null)
const canvas = ref(null)
const stream = ref(null)

const cameraActive = ref(false)
const loading = ref(false)
const message = ref('')
const messageType = ref('success')
const coordinates = ref(null)
const cameraError = ref('')

// ============ KAMERA (DEPAN / SELFIE) ============
async function startCamera() {
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'user' },   // ✅ kamera depan, fallback jika tidak ada
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    })

    if (video.value) {
      video.value.srcObject = stream.value
      await video.value.play()
      cameraActive.value = true
      cameraError.value = ''
    }
  } catch (error) {
    cameraActive.value = false
    cameraError.value =
      'Kamera belum dapat diakses. Izinkan akses kamera pada browser lalu muat ulang halaman.'
    showMessage(cameraError.value + ' ' + error.message, 'error')
  }
}

function stopCamera() {
  stream.value?.getTracks().forEach(track => track.stop())
  stream.value = null
  cameraActive.value = false
}

// ============ GPS ============
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser tidak mendukung GPS'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        })
      },
      error => {
        let msg = ''
        switch (error.code) {
          case 1:
            msg = 'Izin lokasi ditolak. Aktifkan Location pada pengaturan browser.'
            break
          case 2:
            msg = 'Lokasi tidak tersedia. Periksa Location Services perangkat.'
            break
          case 3:
            msg = 'GPS timeout. Coba lagi atau gunakan perangkat lain.'
            break
          default:
            msg = 'Terjadi kesalahan saat mengambil lokasi.'
        }
        reject(new Error(msg))
      },
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 10000
      }
    )
  })
}

// ============ CAPTURE FOTO (MIRROR UNTUK SELFIE) ============
function capturePhoto() {
  if (!video.value || !video.value.videoWidth) {
    throw new Error('Kamera belum siap')
  }

  const element = canvas.value
  element.width = video.value.videoWidth
  element.height = video.value.videoHeight

  const context = element.getContext('2d')

  // Mirror untuk kamera depan agar hasil selfie natural
  context.translate(element.width, 0)
  context.scale(-1, 1)
  context.drawImage(video.value, 0, 0, element.width, element.height)

  return new Promise((resolve, reject) => {
    element.toBlob(
      blob => {
        if (!blob) {
          reject(new Error('Gagal mengambil foto'))
          return
        }
        resolve(blob)
      },
      'image/jpeg',
      0.85
    )
  })
}

function showMessage(text, type = 'success') {
  message.value = text
  messageType.value = type
}

// ============ HANDLER TOMBOL "PESAN SEKARANG" ============
async function handlePesanSekarang() {
  if (loading.value) return

  if (!cameraActive.value) {
    showMessage(
      'Kamera belum aktif. Mohon tunggu sebentar atau muat ulang halaman.',
      'error'
    )
    return
  }

  loading.value = true
  message.value = ''
  coordinates.value = null

  try {
    // 1. Ambil foto dari kamera depan
    const photoBlob = await capturePhoto()

    // 2. Ambil lokasi GPS
    const location = await getLocation()
    coordinates.value = location

    // 3. Upload foto ke Supabase Storage
    const fileName = `${crypto.randomUUID()}.jpg`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('attendance-photos')
      .upload(fileName, photoBlob, {
        contentType: 'image/jpeg',
        upsert: false
      })

    if (uploadError) throw uploadError

    // 4. Simpan data ke tabel attendance
    const { error: insertError } = await supabase
      .from('attendance')
      .insert({
        employee_name: 'Pelanggan Borneo Car Wash',
        photo_path: uploadData.path,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        attendance_type: 'check_in'
      })

    if (insertError) throw insertError

    // showMessage(
    //   'Pesanan berhasil! Foto dan lokasi sudah dikirim ke admin.',
    //   'success'
    // )

    // 5. Scroll ke section layanan setelah sukses
    setTimeout(() => {
      document.querySelector('#layanan')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    }, 600)
  } catch (error) {
    console.error(error)
    showMessage('Pesanan gagal: ' + error.message, 'error')
  } finally {
    loading.value = false
  }
}

// ============ LIFECYCLE ============
onMounted(async () => {
  await startCamera()
})

onUnmounted(() => {
  stopCamera()
})
</script>

<template>
  <main class="page-shell">
    <div class="app">
      <header class="topbar">
        <a class="brand" href="#" aria-label="Borneo Car Wash">
          <span class="brand-mark">B</span>
          <span class="brand-copy">
            <strong>BORNEO</strong>
            <small>CAR WASH</small>
          </span>
        </a>
        <button class="menu-button" type="button" aria-label="Buka menu">
          <span></span><span></span><span></span>
        </button>
      </header>

      <!-- Video stream tersembunyi: kamera tetap jalan untuk capture -->
      <video
        ref="video"
        class="camera-stream-hidden"
        autoplay
        muted
        playsinline
      ></video>
      <canvas ref="canvas" hidden></canvas>

      <section class="hero">
        <div class="hero-copy">
          <span class="eyebrow">WELCOME TO</span>
          <h1>Borneo<br /><span>Car Wash</span></h1>
          <p class="address">
            <span class="pin">●</span>
            Jl. Anggrek 23, Ponorogo
          </p>
          <p class="tagline">Mobil Bersih,<br />Perjalanan Lebih Nyaman.</p>

          <!-- Bungkus tombol dan pesan agar berada di layer paling atas -->
          <div class="action-area">
            <button
              class="primary-button"
              :disabled="loading || !cameraActive"
              @click="handlePesanSekarang"
            >
              <span class="calendar-icon">▦</span>
              {{
                loading
                  ? 'Memproses Pesanan...'
                  : cameraActive
                    ? 'Pesan Sekarang'
                    : 'Menyiapkan Kamera...'
              }}
              <span class="arrow">→</span>
            </button>

            <!-- <div v-if="message" class="message-box" :class="messageType">
              {{ message }}
            </div>

            <div v-if="coordinates" class="location-info">
              <p>
                📍 Lokasi terdeteksi: {{ coordinates.latitude.toFixed(5) }},
                {{ coordinates.longitude.toFixed(5) }}
                (±{{ Math.round(coordinates.accuracy) }} m)
              </p>
            </div> -->
          </div>
        </div>

        <div class="hero-art" role="img" aria-label="Ilustrasi mobil sedang dicuci">
          <div class="sun"></div>
          <div class="cloud cloud-one"></div>
          <div class="cloud cloud-two"></div>
          <div class="wash-sign">CAR WASH</div>
          <div class="wash-bay">
            <div class="water-line"></div>
            <div class="foam foam-one"></div>
            <div class="foam foam-two"></div>
            <div class="car">
              <div class="car-window"></div>
              <div class="car-body"></div>
              <div class="wheel wheel-left"></div>
              <div class="wheel wheel-right"></div>
              <div class="headlight"></div>
            </div>
            <span class="splash splash-one">✦</span>
            <span class="splash splash-two">✧</span>
          </div>
        </div>
        <div class="wave wave-one"></div>
        <div class="wave wave-two"></div>
      </section>

      <section id="layanan" class="services">
        <div class="section-heading">
          <span class="sparkle">✦</span>
          <div>
            <h2>Pilih Layanan Kami</h2>
            <p>Dapatkan layanan terbaik untuk kendaraan Anda</p>
          </div>
        </div>

        <div class="vehicle-grid">
          <a class="vehicle-card" href="#paket">
            <div class="vehicle-art car-icon">
              <span class="vehicle-window"></span>
              <span class="vehicle-wheel left"></span>
              <span class="vehicle-wheel right"></span>
            </div>
            <h3>Mobil</h3>
            <span class="card-arrow">→</span>
          </a>
          <a class="vehicle-card" href="#paket">
            <div class="vehicle-art motor-icon">
              <span class="motor-seat"></span>
              <span class="motor-wheel left"></span>
              <span class="motor-wheel right"></span>
            </div>
            <h3>Motor</h3>
            <span class="card-arrow">→</span>
          </a>
          <a class="vehicle-card" href="#paket">
            <div class="vehicle-art suv-icon">
              <span class="vehicle-window"></span>
              <span class="vehicle-wheel left"></span>
              <span class="vehicle-wheel right"></span>
            </div>
            <h3>Mobil SUV</h3>
            <span class="card-arrow">→</span>
          </a>
        </div>

        <div id="paket" class="benefits">
          <div class="benefit">
            <span class="benefit-icon">✓</span>
            <span>Bersih<br />Maksimal</span>
          </div>
          <div class="benefit">
            <span class="benefit-icon">◷</span>
            <span>Proses<br />Cepat</span>
          </div>
          <div class="benefit">
            <span class="benefit-icon">★</span>
            <span>Harga<br />Terbaik</span>
          </div>
        </div>
      </section>

      <footer class="footer">
        <strong>Borneo Car Wash</strong>
        <span>Jl. Anggrek 23, Ponorogo</span>
      </footer>
    </div>
  </main>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');

:root {
  font-family: 'Nunito', sans-serif;
  color: #10285c;
  background: #edf4ff;
  font-synthesis: none;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  background: #edf4ff;
}

a {
  color: inherit;
  text-decoration: none;
}

.page-shell {
  min-height: 100vh;
  padding: 28px 16px;
  background:
    radial-gradient(circle at 12% 10%, #d5e9ff 0, transparent 30%),
    linear-gradient(135deg, #f6f9ff, #e6f0ff);
}

.app {
  position: relative;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 30px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(26, 75, 145, .16);
}

.topbar {
  position: absolute;
  z-index: 5;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 22px 28px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 3px solid #fff;
  border-radius: 14px;
  background: #ffca27;
  color: #063b91;
  font-size: 25px;
  font-weight: 900;
  transform: rotate(-7deg);
}

.brand-copy {
  display: grid;
  line-height: 1;
  color: #063b91;
}

.brand-copy strong {
  font-size: 19px;
  font-weight: 900;
  letter-spacing: .5px;
}

.brand-copy small {
  margin-top: 4px;
  color: #ffb900;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 2px;
}

.menu-button {
  display: grid;
  width: 48px;
  height: 48px;
  place-content: center;
  gap: 5px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 8px 24px rgba(12, 67, 145, .12);
}

.menu-button span {
  display: block;
  width: 19px;
  height: 2.5px;
  border-radius: 9px;
  background: #063b91;
}

.hero {
  position: relative;
  min-height: 690px;
  padding: 126px 36px 110px;
  overflow: hidden;
  background: linear-gradient(150deg, #b9e8ff 0%, #e9f8ff 43%, #5ab8f8 100%);
}

.hero::before {
  position: absolute;
  top: -130px;
  right: -90px;
  width: 360px;
  height: 360px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .24);
  content: '';
}

.hero-copy {
  position: relative;
  z-index: 2;
  width: 48%;
}

.eyebrow {
  color: #1874cb;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 3px;
}

h1 {
  margin: 8px 0 12px;
  color: #082c6d;
  font-size: clamp(42px, 11vw, 57px);
  font-weight: 900;
  letter-spacing: -2px;
  line-height: .98;
}

h1 span {
  color: #0877df;
}

.address {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 5px 0 0;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, .85);
  border-radius: 30px;
  background: rgba(255, 255, 255, .88);
  color: #10285c;
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 5px 18px rgba(29, 111, 184, .08);
}

.pin {
  color: #f04452;
  font-size: 15px;
}

.tagline {
  margin: 17px 0 20px;
  color: #12376f;
  font-size: 15px;
  font-style: italic;
  font-weight: 800;
  line-height: 1.35;
}

/* ====== AREA TOMBOL & PESAN (DIPERBAIKI) ====== */
.action-area {
  position: relative;
  z-index: 10; /* Memaksa tombol & pesan selalu di atas ilustrasi */
  margin-top: 20px;
}

.primary-button {
  display: inline-flex;
  min-height: 56px;
  align-items: center;
  gap: 10px;
  padding: 0 17px;
  border: 2px solid #ffe477;
  border-radius: 30px;
  background: linear-gradient(180deg, #ffdc45, #ffb900);
  color: #092d70;
  font-size: 15px;
  font-weight: 900;
  box-shadow: 0 8px 0 #e59b00, 0 13px 24px rgba(173, 116, 0, .18);
  cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
  position: relative;
  z-index: 10;
}

.primary-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 0 #e59b00, 0 16px 28px rgba(173, 116, 0, .22);
}

.primary-button:active:not(:disabled) {
  transform: translateY(3px);
  box-shadow: 0 5px 0 #e59b00, 0 8px 16px rgba(173, 116, 0, .18);
}

.primary-button:disabled {
  opacity: .6;
  cursor: not-allowed;
  box-shadow: 0 4px 0 #c99a2e;
}

.calendar-icon {
  font-size: 21px;
}

.arrow {
  font-size: 22px;
}

/* ====== VIDEO STREAM TERSEMBUNYI ====== */
.camera-stream-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}

/* ====== MESSAGE BOX & LOCATION INFO ====== */
.message-box {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
  position: relative;
  z-index: 10; /* Pastikan pesan tidak tertutup */
}

.message-box.success {
  background: #e6f8ec;
  border: 1px solid #9de0b4;
  color: #1b7a3d;
}

.message-box.error {
  background: #fdeaea;
  border: 1px solid #f5a8a8;
  color: #b32a2a;
}

.location-info {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, .7);
  font-size: 11px;
  font-weight: 700;
  color: #12376f;
  position: relative;
  z-index: 10;
}

/* ====== HERO ART (ILUSTRASI) ====== */
.hero-art {
  position: absolute;
  right: 0;
  bottom: 56px;
  width: 54%;
  height: 390px;
  border: 8px solid rgba(255, 255, 255, .5);
  border-right: 0;
  border-radius: 150px 0 0 20px;
  background: linear-gradient(180deg, #168de8 0%, #0756b5 70%, #0b3c87 100%);
  box-shadow: inset 0 15px 30px rgba(255, 255, 255, .2);
  z-index: 1; /* Turunkan posisinya di bawah tombol */
  pointer-events: none; /* Biarkan klik menembus ilustrasi jika bertumpuk */
}

.sun {
  position: absolute;
  top: 22px;
  right: 38px;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  background: #ffe78a;
  box-shadow: 0 0 0 12px rgba(255, 255, 255, .15);
}

.cloud {
  position: absolute;
  z-index: 1;
  height: 25px;
  border-radius: 30px;
  background: #fff;
  opacity: .9;
}

.cloud::before,
.cloud::after {
  position: absolute;
  bottom: 5px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: inherit;
  content: '';
}

.cloud::before {
  left: 12px;
}

.cloud::after {
  right: 13px;
  width: 23px;
  height: 23px;
}

.cloud-one {
  top: 50px;
  left: 15px;
  width: 82px;
}

.cloud-two {
  top: 92px;
  right: 10px;
  width: 72px;
  transform: scale(.7);
}

/* Tulisan CAR WASH digeser ke atas agar tidak menabrak tombol */
.wash-sign {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 2;
  padding: 8px 18px;
  border: 4px solid #ffdc45;
  border-radius: 8px;
  background: #0752a9;
  color: #fff;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 2px;
  transform: rotate(-3deg);
}

.wash-bay {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 210px;
  border-top: 8px solid #ffca27;
  background: repeating-linear-gradient(90deg, #073c87 0 12px, #0b63bd 12px 18px);
}

.water-line {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(110deg, transparent 0 25px, rgba(255, 255, 255, .2) 26px 28px);
}

.foam {
  position: absolute;
  z-index: 3;
  border-radius: 50%;
  background: #fff;
  box-shadow: 13px 4px 0 -3px #fff, 27px -5px 0 -5px #fff, -12px -7px 0 -4px #fff;
}

.foam-one {
  top: 36px;
  left: 44%;
  width: 25px;
  height: 20px;
}

.foam-two {
  top: 76px;
  right: 17%;
  width: 18px;
  height: 17px;
}

.car {
  position: absolute;
  z-index: 4;
  right: 8%;
  bottom: 23px;
  width: 76%;
  height: 100px;
}

.car-body {
  position: absolute;
  right: 0;
  bottom: 9px;
  left: 0;
  height: 58px;
  border: 4px solid #d9e8f6;
  border-radius: 42px 50px 17px 17px;
  background: linear-gradient(180deg, #fff 0%, #c9d9e8 100%);
  box-shadow: 0 10px 0 rgba(0, 0, 0, .13);
}

.car-window {
  position: absolute;
  z-index: 2;
  top: 4px;
  left: 25%;
  width: 48%;
  height: 43px;
  border: 5px solid #d9e8f6;
  border-radius: 50px 50px 5px 5px;
  background: linear-gradient(135deg, #174b78, #071d3b);
}

.wheel {
  position: absolute;
  z-index: 5;
  bottom: 0;
  width: 34px;
  height: 34px;
  border: 7px solid #192e48;
  border-radius: 50%;
  background: #a9c4d9;
}

.wheel-left {
  left: 18%;
}

.wheel-right {
  right: 16%;
}

.headlight {
  position: absolute;
  z-index: 5;
  right: 1px;
  bottom: 31px;
  width: 13px;
  height: 10px;
  border-radius: 4px;
  background: #fff5a7;
}

.splash {
  position: absolute;
  z-index: 5;
  color: #fff;
  font-size: 35px;
}

.splash-one {
  top: 20px;
  left: 22%;
}

.splash-two {
  top: 80px;
  right: 10%;
}

.wave {
  position: absolute;
  z-index: 1;
  right: -10%;
  bottom: -53px;
  width: 120%;
  height: 100px;
  border-radius: 50% 50% 0 0;
}

.wave-one {
  background: #0874d7;
  transform: rotate(-5deg);
}

.wave-two {
  bottom: -73px;
  background: #fff;
  transform: rotate(4deg);
}

.services {
  position: relative;
  z-index: 2;
  margin-top: -4px;
  padding: 38px 36px 32px;
  border-radius: 34px 34px 0 0;
  background: #fff;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 22px;
}

.sparkle {
  color: #0789ef;
  font-size: 29px;
}

.section-heading h2 {
  margin: 0;
  color: #0b2559;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -.5px;
}

.section-heading p {
  margin: 4px 0 0;
  color: #66799c;
  font-size: 12px;
  line-height: 1.4;
}

.vehicle-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.vehicle-card {
  display: flex;
  min-width: 0;
  min-height: 178px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 6px;
  border: 1px solid #e1edff;
  border-radius: 24px;
  background: linear-gradient(145deg, #f5f9ff, #eaf3ff);
  box-shadow: 0 7px 18px rgba(44, 105, 179, .06);
}

.vehicle-card h3 {
  margin: 10px 0;
  color: #0b2559;
  font-size: 14px;
  font-weight: 900;
}

.vehicle-art {
  position: relative;
  width: 82px;
  height: 61px;
}

.car-icon::before,
.suv-icon::before {
  position: absolute;
  right: 4px;
  bottom: 11px;
  left: 4px;
  height: 29px;
  border: 3px solid #0759b8;
  border-radius: 14px 18px 7px 7px;
  background: linear-gradient(#43b9ff, #0875d8);
  content: '';
}

.car-icon::after,
.suv-icon::after {
  position: absolute;
  top: 10px;
  left: 24px;
  width: 39px;
  height: 22px;
  border: 3px solid #0759b8;
  border-radius: 15px 15px 3px 3px;
  background: #bceaff;
  content: '';
}

.suv-icon::before {
  bottom: 10px;
  height: 38px;
  border-radius: 8px 12px 7px 7px;
  background: linear-gradient(#fff, #b8d6ef);
}

.suv-icon::after {
  top: 8px;
  left: 22px;
  width: 42px;
  height: 26px;
}

.vehicle-window {
  display: none;
}

.vehicle-wheel {
  position: absolute;
  z-index: 2;
  bottom: 4px;
  width: 17px;
  height: 17px;
  border: 4px solid #16365f;
  border-radius: 50%;
  background: #b9d7ed;
}

.vehicle-wheel.left {
  left: 16px;
}

.vehicle-wheel.right {
  right: 15px;
}

.motor-icon::before {
  position: absolute;
  top: 19px;
  left: 18px;
  width: 48px;
  height: 22px;
  border-radius: 15px 10px 8px 8px;
  background: #0875d8;
  content: '';
  transform: skew(-15deg);
}

.motor-seat {
  position: absolute;
  z-index: 2;
  top: 13px;
  left: 32px;
  width: 29px;
  height: 8px;
  border-radius: 8px;
  background: #16365f;
  transform: rotate(-8deg);
}

.motor-wheel {
  position: absolute;
  z-index: 3;
  bottom: 6px;
  width: 22px;
  height: 22px;
  border: 5px solid #16365f;
  border-radius: 50%;
  background: #b9d7ed;
}

.motor-wheel.left {
  left: 8px;
}

.motor-wheel.right {
  right: 8px;
}

.card-arrow {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 50%;
  background: #d7eaff;
  color: #0875d8;
  font-size: 20px;
  font-weight: 900;
}

.benefits {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 22px;
  padding: 17px 8px;
  border-radius: 23px;
  background: #e8f2ff;
}

.benefit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #123a80;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.25;
}

.benefit + .benefit {
  border-left: 1px solid #c4d9f7;
}

.benefit-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 50%;
  background: #0b4caa;
  color: #fff;
  font-size: 17px;
  font-weight: 900;
}

.footer {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 16px;
  background: #f6f9ff;
  color: #7183a2;
  text-align: center;
  font-size: 11px;
}

.footer strong {
  color: #123a80;
  font-size: 13px;
}

/* ====== MEDIA QUERIES (RESPONSIVE) ====== */

@media (min-width: 900px) {
  .page-shell { padding: 32px; }
  .app { border-radius: 30px; }
  .hero { min-height: 650px; padding: 150px 64px 100px; }
  .hero-copy { width: 44%; }
  h1 { font-size: clamp(58px, 6vw, 78px); }
  .address { font-size: 14px; }
  .tagline { font-size: 18px; }
  .primary-button { min-height: 64px; padding: 0 25px; font-size: 17px; }
  .hero-art { right: 0; bottom: 48px; width: 55%; height: 450px; border-radius: 190px 0 0 24px; }
  .services { padding: 48px 64px 38px; }
  .section-heading h2 { font-size: 28px; }
  .section-heading p { font-size: 15px; }
  .vehicle-grid { gap: 22px; }
  .vehicle-card { min-height: 220px; }
  .vehicle-card h3 { font-size: 18px; }
  .benefits { padding: 22px; }
  .benefit { font-size: 14px; gap: 12px; }
  .benefit-icon { width: 38px; height: 38px; flex-basis: 38px; }
}

@media (min-width: 700px) and (max-width: 899px) {
  .page-shell { padding: 20px; }
  .hero { min-height: 620px; }
  .hero-copy { width: 48%; }
  .hero-art { width: 52%; height: 350px; }
  .services { padding: 32px 28px; }
}

@media (max-width: 699px) {
  .page-shell { padding: 0; background: #fff; }
  .app { max-width: 480px; min-height: 100vh; border-radius: 0; box-shadow: none; }
  .topbar { padding: 18px 20px; }
  
  /* Diperbaiki untuk layar HP */
  .hero { 
    min-height: 740px; /* Ditinggikan agar tombol punya ruang napas */
    padding: 126px 25px 110px; 
  }
  
  .hero-copy { width: 90%; } /* Diperlebar agar tombol muat */
  
  .hero-art { 
    right: -20px; 
    bottom: 30px; 
    width: 85%; 
    height: 320px; 
    opacity: 0.9; /* Sedikit transparan agar teks di belakang tetap terbaca */
  }
  
  .wash-sign {
    top: 10px; /* Digeser ke atas di mobile agar tidak menutupi tombol */
    left: 10px;
    font-size: 12px;
    padding: 6px 12px;
  }

  .services { padding: 28px 20px 25px; }
  .vehicle-grid { gap: 10px; }
  .vehicle-card { min-height: 178px; }
}

@media (max-width: 370px) {
  .hero { min-height: 680px; padding-right: 18px; padding-left: 18px; }
  .hero-art { width: 88%; height: 300px; }
  .vehicle-grid { gap: 7px; }
  .vehicle-card { min-height: 160px; }
  .section-heading h2 { font-size: 20px; }
  .benefit { gap: 4px; font-size: 10px; }
}
</style>