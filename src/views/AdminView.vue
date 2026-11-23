<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { supabase } from '../services/supabase'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@fortawesome/fontawesome-free/css/all.min.css'

const attendances = ref([])
const loading = ref(true)
const errorMessage = ref('')
const mapElement = ref(null)
const mapPanel = ref(null)
const detailPanel = ref(null)
const cancelButton = ref(null)

let map = null
let markerLayer = null
let realtimeChannel = null
let tileLayers = null
let pinIcon = null
let resizeObserver = null

const totalAttendance = ref(0)
const activeLayer = ref('satellite') // Default: Satellite

// State untuk panel detail lokasi (di samping peta)
const selectedLocation = ref(null)

// State UI saja (tidak menyentuh data)
const showDeleteConfirm = ref(false)
const deleting = ref(false)
const deleteError = ref('')
const notice = ref('')

const sidebarOpen = ref(false)
const isFullscreen = ref(false)
const canFullscreen =
  typeof document !== 'undefined' && !!document.documentElement.requestFullscreen

function formatDate(date) {
  return new Date(date).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

function getPhotoUrl(path) {
  const { data } = supabase.storage
    .from('attendance-photos')
    .getPublicUrl(path)
  return data.publicUrl
}

async function fetchAttendance() {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    errorMessage.value = error.message
    return
  }

  errorMessage.value = ''
  attendances.value = data || []
  totalAttendance.value = attendances.value.length

  updateMarkers()
}

// ============ LEAFLET MAP LOGIC ============
function initializeMap() {
  if (!mapElement.value || map) return

  // Center awal (Ponorogo)
  map = L.map(mapElement.value).setView([-7.86520, 111.46680], 13)

  // Layer definitions
  tileLayers = {
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri'
    }),
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }),
    terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
    })
  }

  // Set default layer
  tileLayers.satellite.addTo(map)

  // Marker berupa ikon FontAwesome saja
  pinIcon = L.divIcon({
    html: '<i class="fa-solid fa-location-dot"></i>',
    className: 'gt-marker',
    iconSize: [30, 36],
    iconAnchor: [15, 34],
    popupAnchor: [0, -32]
  })

  markerLayer = L.layerGroup().addTo(map)
}

function changeLayer(layerName) {
  if (!map || !tileLayers) return

  activeLayer.value = layerName
  // Hapus semua layer
  Object.values(tileLayers).forEach(layer => map.removeLayer(layer))
  // Tambahkan layer baru
  tileLayers[layerName].addTo(map)
}

function updateMarkers() {
  if (!map || !markerLayer) return

  markerLayer.clearLayers()
  const validCoordinates = []

  attendances.value.forEach(item => {
    const lat = Number(item.latitude)
    const lng = Number(item.longitude)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return

    // Marker
    const marker = L.marker([lat, lng], { icon: pinIcon }).addTo(markerLayer)

    // Popup
    marker.bindPopup(`
      <div class="gt-popup">
        <img src="${getPhotoUrl(item.photo_path)}" alt="Foto lokasi" />
        <div class="gt-popup-title">Foto #${item.id || '001'}</div>
        <div class="gt-popup-row"><i class="fa-solid fa-location-dot"></i><span>${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>
        <div class="gt-popup-row"><i class="fa-regular fa-calendar"></i><span>${formatDate(item.created_at)}</span></div>
        <button type="button" onclick="window.selectLocation(${item.id})">Lihat detail</button>
      </div>
    `)

    // Event klik marker untuk update panel detail
    marker.on('click', () => {
      selectedLocation.value = item
    })

    validCoordinates.push([lat, lng])
  })

  if (validCoordinates.length === 1) {
    map.setView(validCoordinates[0], 16)
  } else if (validCoordinates.length > 1) {
    map.fitBounds(validCoordinates, { padding: [30, 30] })
  }
}

function selectLocation(id) {
  const item = attendances.value.find(a => a.id === id)
  if (item) {
    selectedLocation.value = item
    map?.setView([item.latitude, item.longitude], 17)
    map?.closePopup()
  }
}

// Fungsi global untuk dipanggil dari Popup HTML
window.selectLocation = selectLocation

// Klik foto: tampilkan di panel detail. Di layar sempit panel berada
// di bawah peta, jadi digulir ke sana.
async function openPhoto(item) {
  selectLocation(item.id)
  if (window.matchMedia('(max-width: 1100px)').matches) {
    await nextTick()
    detailPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// ============ HAPUS DATA ============
async function askDelete() {
  deleteError.value = ''
  showDeleteConfirm.value = true
  await nextTick()
  cancelButton.value?.focus()
}

function closeDelete() {
  if (!deleting.value) showDeleteConfirm.value = false
}

async function deleteSelected() {
  const item = selectedLocation.value
  if (!item || deleting.value) return

  deleting.value = true
  deleteError.value = ''
  notice.value = ''

  // 1) Hapus baris data. select() dipakai supaya ketahuan kalau
  //    tidak ada baris yang terhapus (misalnya diblokir kebijakan RLS).
  const { data, error } = await supabase
    .from('attendance')
    .delete()
    .eq('id', item.id)
    .select()

  if (error) {
    deleteError.value = `Gagal menghapus: ${error.message}`
    deleting.value = false
    return
  }
  if (!data || data.length === 0) {
    deleteError.value = 'Data tidak terhapus. Periksa izin hapus (policy DELETE) di Supabase.'
    deleting.value = false
    return
  }

  // 2) Hapus file fotonya dari storage
  if (item.photo_path) {
    const { error: storageError } = await supabase.storage
      .from('attendance-photos')
      .remove([item.photo_path])
    if (storageError) {
      notice.value = `Data terhapus, tetapi file foto gagal dihapus dari storage: ${storageError.message}`
    }
  }

  // 3) Rapikan tampilan
  selectedLocation.value = null
  showDeleteConfirm.value = false
  map?.closePopup()
  deleting.value = false
  await fetchAttendance()
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    mapPanel.value?.requestFullscreen?.()
  }
}

function syncFullscreen() {
  isFullscreen.value = document.fullscreenElement === mapPanel.value
}

function subscribeRealtime() {
  realtimeChannel = supabase
    .channel('attendance-live')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'attendance' },
      async () => { await fetchAttendance() }
    )
    .subscribe()
}

onMounted(async () => {
  loading.value = true
  await nextTick()
  initializeMap()

  // Peta ikut menyesuaikan saat ukuran wadahnya berubah
  // (panel detail berubah tinggi, layar penuh, rotasi layar, dll.)
  if (window.ResizeObserver && mapElement.value) {
    resizeObserver = new ResizeObserver(() => map?.invalidateSize())
    resizeObserver.observe(mapElement.value)
  }
  document.addEventListener('fullscreenchange', syncFullscreen)

  await fetchAttendance()
  subscribeRealtime()
  loading.value = false
})

onUnmounted(() => {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel)
  resizeObserver?.disconnect()
  document.removeEventListener('fullscreenchange', syncFullscreen)
  if (window.selectLocation === selectLocation) delete window.selectLocation
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<template>
  <div class="admin-layout" :class="{ 'nav-open': sidebarOpen }">
    <div class="scrim" @click="sidebarOpen = false"></div>

    <!-- SIDEBAR -->
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <span class="brand-mark"><i class="fa-solid fa-location-dot"></i></span>
        <div class="brand-text">
          <h2>GeoTrack</h2>
          <p>Admin Panel</p>
        </div>
        <button
          type="button"
          class="icon-btn sidebar-close"
          aria-label="Tutup menu"
          @click="sidebarOpen = false"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <nav class="nav" aria-label="Menu utama">
        <a href="#" class="nav-item active" aria-current="page">
          <i class="fa-solid fa-gauge-high"></i><span>Dashboard</span>
        </a>
        <a href="#" class="nav-item">
          <i class="fa-solid fa-images"></i><span>Data Foto</span>
        </a>
        <a href="#" class="nav-item">
          <i class="fa-solid fa-map-location-dot"></i><span>Peta Lokasi</span>
        </a>
        <a href="#" class="nav-item">
          <i class="fa-solid fa-database"></i><span>Manajemen Data</span>
        </a>
        <a href="#" class="nav-item">
          <i class="fa-solid fa-gear"></i><span>Pengaturan</span>
        </a>
      </nav>

      <div class="sidebar-foot">
        <p class="sidebar-foot-title">GIS Monitoring System</p>
        <p>v1.0.0</p>
        <p>© 2026 GeoTrack</p>
      </div>
    </aside>

    <!-- MAIN CONTENT -->
    <div class="main">
      <main class="content">
        <!-- TITLE SECTION -->
        <div class="page-head">
          <div class="page-head-main">
            <button
              type="button"
              class="icon-btn bordered menu-toggle"
              aria-label="Buka menu"
              aria-controls="sidebar"
              :aria-expanded="sidebarOpen"
              @click="sidebarOpen = true"
            >
              <i class="fa-solid fa-bars"></i>
            </button>
            <div>
              <h1>Dashboard</h1>
              <p>Monitoring data foto dan lokasi secara real-time</p>
            </div>
          </div>
          <div class="date-range">
            <i class="fa-regular fa-calendar"></i>
            <span>23 Nov 2026 – 23 Nov 2026</span>
            <i class="fa-solid fa-chevron-down"></i>
          </div>
        </div>

        <div v-if="errorMessage" class="alert" role="alert">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>Gagal memuat data: {{ errorMessage }}</span>
        </div>

        <div v-if="notice" class="alert" role="status">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>{{ notice }}</span>
        </div>

        <!-- STATS -->
        <section class="stats" aria-label="Ringkasan">
          <div class="stat">
            <i class="fa-solid fa-images"></i>
            <div>
              <p class="stat-label">Total foto</p>
              <p class="stat-value">{{ totalAttendance }}</p>
            </div>
          </div>
          <div class="stat">
            <i class="fa-solid fa-location-dot"></i>
            <div>
              <p class="stat-label">Lokasi terekam</p>
              <p class="stat-value">{{ totalAttendance }}</p>
            </div>
          </div>
          <div class="stat">
            <i class="fa-regular fa-calendar-check"></i>
            <div>
              <p class="stat-label">Data hari ini</p>
              <p class="stat-value">48</p>
            </div>
          </div>
          <div class="stat">
            <i class="fa-solid fa-draw-polygon"></i>
            <div>
              <p class="stat-label">Area terpantau</p>
              <p class="stat-value">12</p>
            </div>
          </div>
        </section>

        <!-- PETA + DETAIL LOKASI -->
        <div class="workspace">
          <section ref="mapPanel" class="panel map-panel">
            <div class="panel-head">
              <h2><i class="fa-solid fa-map-location-dot"></i> Peta lokasi</h2>
              <div class="map-tools">
                <div class="seg" role="group" aria-label="Jenis peta">
                  <button type="button" :class="{ active: activeLayer === 'satellite' }" :aria-pressed="activeLayer === 'satellite'" @click="changeLayer('satellite')">Satelit</button>
                  <button type="button" :class="{ active: activeLayer === 'osm' }" :aria-pressed="activeLayer === 'osm'" @click="changeLayer('osm')">Street</button>
                  <button type="button" :class="{ active: activeLayer === 'terrain' }" :aria-pressed="activeLayer === 'terrain'" @click="changeLayer('terrain')">Terrain</button>
                </div>
                <button
                  v-if="canFullscreen"
                  type="button"
                  class="icon-btn bordered"
                  :aria-label="isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'"
                  @click="toggleFullscreen"
                >
                  <i class="fa-solid" :class="isFullscreen ? 'fa-compress' : 'fa-expand'"></i>
                </button>
              </div>
            </div>
            <div ref="mapElement" class="leaflet-map"></div>
          </section>

          <section ref="detailPanel" class="panel detail-panel">
            <div class="panel-head">
              <h2><i class="fa-solid fa-circle-info"></i> Detail lokasi</h2>
            </div>

            <div v-if="selectedLocation" class="detail-body">
              <div class="detail-photo">
                <img :src="getPhotoUrl(selectedLocation.photo_path)" alt="Foto lokasi terpilih" />
              </div>

              <dl class="facts">
                <div class="fact">
                  <dt><i class="fa-regular fa-image"></i> Nama file</dt>
                  <dd class="break">{{ selectedLocation.photo_path.split('/').pop() }}</dd>
                </div>
                <div class="fact">
                  <dt><i class="fa-solid fa-location-dot"></i> Latitude</dt>
                  <dd>{{ Number(selectedLocation.latitude).toFixed(5) }}</dd>
                </div>
                <div class="fact">
                  <dt><i class="fa-solid fa-location-dot"></i> Longitude</dt>
                  <dd>{{ Number(selectedLocation.longitude).toFixed(5) }}</dd>
                </div>
                <div class="fact">
                  <dt><i class="fa-regular fa-calendar"></i> Tanggal</dt>
                  <dd>{{ formatDate(selectedLocation.created_at) }}</dd>
                </div>
                <div class="fact">
                  <dt><i class="fa-solid fa-map"></i> Lokasi</dt>
                  <dd>Ponorogo, Jawa Timur</dd>
                </div>
              </dl>

              <div class="detail-actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  @click="map?.setView([selectedLocation.latitude, selectedLocation.longitude], 18)"
                >
                  <i class="fa-solid fa-crosshairs"></i> Lihat di peta
                </button>
                <a
                  class="btn"
                  :href="getPhotoUrl(selectedLocation.photo_path)"
                  target="_blank"
                  rel="noopener"
                >
                  <i class="fa-solid fa-up-right-from-square"></i> Buka foto asli
                </a>
                <button type="button" class="btn btn-danger" @click="askDelete">
                  <i class="fa-regular fa-trash-can"></i> Hapus data
                </button>
              </div>
            </div>

            <div v-else class="empty">
              <i class="fa-regular fa-hand-pointer"></i>
              <p>Pilih marker di peta atau foto di bawah untuk melihat foto lengkap dan detail lokasinya.</p>
            </div>
          </section>
        </div>

        <!-- FOTO TERBARU -->
        <section class="panel">
          <div class="panel-head">
            <h2><i class="fa-solid fa-images"></i> Foto terbaru</h2>
            <a href="#" class="see-all">Lihat semua</a>
          </div>

          <div class="photo-grid">
            <button
              v-for="item in attendances.slice(0, 4)"
              :key="item.id"
              type="button"
              class="photo"
              :class="{ active: selectedLocation && selectedLocation.id === item.id }"
              @click="openPhoto(item)"
            >
              <img :src="getPhotoUrl(item.photo_path)" alt="Foto" loading="lazy" />
              <span class="photo-meta">
                <span class="photo-line">
                  <i class="fa-solid fa-location-dot"></i>
                  {{ Number(item.latitude).toFixed(5) }}, {{ Number(item.longitude).toFixed(5) }}
                </span>
                <span class="photo-line muted">
                  <i class="fa-regular fa-calendar"></i>
                  {{ formatDate(item.created_at).split(',')[0] }}
                </span>
              </span>
            </button>

            <p v-if="loading" class="grid-note">Memuat data</p>
            <p v-else-if="attendances.length === 0" class="grid-note">Belum ada foto terbaru</p>
          </div>
        </section>
      </main>
    </div>

    <!-- KONFIRMASI HAPUS -->
    <div
      v-if="showDeleteConfirm && selectedLocation"
      class="modal-backdrop"
      @click.self="closeDelete"
      @keydown.esc="closeDelete"
    >
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-desc">
        <h3 id="del-title">Hapus data ini?</h3>
        <p id="del-desc">
          Data lokasi dan foto <strong class="break">{{ selectedLocation.photo_path.split('/').pop() }}</strong>
          akan dihapus permanen dan tidak bisa dikembalikan.
        </p>
        <p v-if="deleteError" class="modal-error" role="alert">
          <i class="fa-solid fa-triangle-exclamation"></i> {{ deleteError }}
        </p>
        <div class="modal-actions">
          <button ref="cancelButton" type="button" class="btn" :disabled="deleting" @click="closeDelete">Batal</button>
          <button type="button" class="btn btn-danger-solid" :disabled="deleting" @click="deleteSelected">
            <i class="fa-solid" :class="deleting ? 'fa-spinner fa-spin' : 'fa-trash-can'"></i>
            {{ deleting ? 'Menghapus' : 'Hapus data' }}
          </button>
        </div>
      </div>
    </div>
    <!-- /modal -->
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&display=swap');

body {
  margin: 0;
}

/* ============ TOKENS & DASAR ============ */
.admin-layout {
  --bg: #eceef2;
  --surface: #ffffff;
  --line: #d6dae2;
  --ink: #1b2536;
  --muted: #5d6a7e;
  --nav: #172033;
  --nav-line: #2a3650;
  --nav-text: #b6c0d2;
  --accent: #0e6a75;
  --accent-dark: #0a525b;
  --accent-soft: #dcecee;
  --pin: #d92d20;
  --danger-bg: #fdecea;
  --danger: #a32017;

  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--ink);
  font-family: 'Public Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.admin-layout *,
.admin-layout *::before,
.admin-layout *::after {
  box-sizing: border-box;
}

.admin-layout :where(h1, h2, h3, p, dl, dd) {
  margin: 0;
}

.admin-layout :where(button, input) {
  font: inherit;
  color: inherit;
}

.admin-layout :where(button) {
  cursor: pointer;
}

.admin-layout a {
  color: inherit;
}

.admin-layout :focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.admin-layout i[class*='fa-'] {
  flex-shrink: 0;
}

.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: none;
  border: 0;
  border-radius: 4px;
  color: var(--muted);
}

.icon-btn:hover {
  background: rgba(23, 32, 51, 0.06);
  color: var(--ink);
}

.icon-btn.bordered {
  width: 32px;
  height: 32px;
  border: 1px solid var(--line);
  background: var(--surface);
}

/* ============ SIDEBAR ============ */
.scrim {
  display: none;
}

.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 20px 12px;
  background: var(--nav);
  color: var(--nav-text);
  overflow-y: auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  font-size: 15px;
}

.brand-text h2 {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
}

.brand-text p {
  font-size: 12px;
  color: var(--nav-text);
}

.sidebar-close {
  display: none;
  margin-left: auto;
  color: var(--nav-text);
}

.sidebar-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 4px;
  font-weight: 500;
  text-decoration: none;
  color: var(--nav-text);
}

.nav-item i {
  width: 18px;
  text-align: center;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.nav-item.active {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  box-shadow: inset 3px 0 0 #5fc0cb;
}

.sidebar-foot {
  padding: 14px 8px 0;
  border-top: 1px solid var(--nav-line);
  font-size: 12px;
}

.sidebar-foot-title {
  color: #fff;
  font-weight: 600;
}

/* ============ MAIN ============ */
.main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.menu-toggle {
  display: none;
  flex-shrink: 0;
  margin-top: 2px;
}

/* ============ KONTEN ============ */
.content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  min-width: 0;
}

.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.page-head-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.page-head h1 {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
}

.page-head p {
  color: var(--muted);
}

.date-range {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
}

.date-range i:first-child {
  color: var(--muted);
}

.date-range i:last-child {
  font-size: 10px;
  color: var(--muted);
}

.alert {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--danger-bg);
  border: 1px solid #f3c1bc;
  border-radius: 4px;
  color: var(--danger);
}

/* Ringkasan: satu strip, bukan empat kartu terpisah */
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}

.stat {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  background: var(--surface);
}

.stat > i {
  width: 20px;
  text-align: center;
  font-size: 18px;
  color: var(--accent);
}

.stat-label {
  font-size: 13px;
  color: var(--muted);
}

.stat-value {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
}

/* ============ PANEL ============ */
.panel {
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
}

.panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  min-height: 52px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}

.panel-head h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
}

.panel-head h2 i {
  color: var(--muted);
  font-size: 14px;
}

.see-all {
  font-size: 13px;
  font-weight: 500;
  color: var(--accent);
  text-decoration: none;
}

.see-all:hover {
  text-decoration: underline;
}

/* Peta di kiri, detail di sampingnya */
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  align-items: stretch;
}

.map-panel {
  display: flex;
  flex-direction: column;
  min-height: 480px;
}

.map-panel:fullscreen {
  border-radius: 0;
  border: 0;
}

.map-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
}

.seg button {
  padding: 5px 12px;
  background: var(--surface);
  border: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}

.seg button + button {
  border-left: 1px solid var(--line);
}

.seg button:hover {
  color: var(--ink);
}

.seg button.active {
  background: var(--accent);
  color: #fff;
}

.leaflet-map {
  flex: 1;
  min-height: 380px;
  isolation: isolate;
  border-radius: 0 0 5px 5px;
}

/* ============ DETAIL ============ */
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.detail-photo {
  display: grid;
  place-items: center;
  background: #dfe2e8;
  border-radius: 3px;
  overflow: hidden;
}

.detail-photo img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: min(60vh, 520px);
}

.facts {
  display: flex;
  flex-direction: column;
}

.fact {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}

.fact:last-child {
  border-bottom: 0;
}

.fact dt {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--muted);
}

.fact dt i {
  width: 14px;
  text-align: center;
  font-size: 12px;
}

.fact dd {
  font-weight: 500;
  text-align: right;
}

.fact dd.break {
  overflow-wrap: anywhere;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1 1 140px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 4px;
  font-weight: 500;
  text-decoration: none;
}

.btn:hover {
  background: var(--bg);
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn-primary:hover {
  background: var(--accent-dark);
}

.btn-danger {
  flex-basis: 100%;
  color: var(--danger);
  border-color: #e8b9b4;
}

.btn-danger:hover {
  background: var(--danger-bg);
}

.btn-danger-solid {
  flex: 0 1 auto;
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}

.btn-danger-solid:hover {
  background: #861810;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(12, 18, 30, 0.55);
}

.modal {
  width: min(420px, 100%);
  padding: 20px;
  background: var(--surface);
  border-radius: 6px;
}

.modal h3 {
  margin-bottom: 8px;
  font-size: 17px;
  font-weight: 600;
}

.modal p {
  color: var(--muted);
}

.modal strong {
  color: var(--ink);
  font-weight: 600;
}

.modal strong.break {
  overflow-wrap: anywhere;
}

.modal-error {
  margin-top: 12px;
  padding: 8px 10px;
  background: var(--danger-bg);
  border-radius: 4px;
  color: var(--danger) !important;
  font-size: 13px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.modal-actions .btn {
  flex: 0 1 auto;
  min-width: 96px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 28px;
  text-align: center;
  color: var(--muted);
}

.empty i {
  font-size: 26px;
}

.empty p {
  max-width: 28ch;
}

/* ============ FOTO TERBARU ============ */
.photo-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
}

.photo {
  display: flex;
  flex-direction: column;
  padding: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  text-align: left;
}

.photo:hover {
  border-color: var(--muted);
}

.photo.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent);
}

.photo img {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: #dfe2e8;
}

.photo-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px 10px;
}

.photo-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}

.photo-line i {
  width: 12px;
  text-align: center;
  font-size: 11px;
  color: var(--muted);
}

.photo-line.muted {
  color: var(--muted);
  font-weight: 400;
}

.grid-note {
  grid-column: 1 / -1;
  padding: 20px 0;
  text-align: center;
  color: var(--muted);
}

/* ============ MARKER & POPUP LEAFLET ============ */
.admin-layout .leaflet-container {
  font-family: inherit;
}

.admin-layout .gt-marker {
  display: grid;
  place-items: center;
  background: none;
  border: 0;
  font-size: 34px;
  line-height: 1;
  color: var(--pin);
  filter: drop-shadow(0 0 1.5px #fff) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
}

.admin-layout .gt-marker:hover {
  color: #b42318;
}

.admin-layout .leaflet-popup-content-wrapper {
  border-radius: 4px;
}

.admin-layout .leaflet-popup-content {
  margin: 10px;
}

.admin-layout .gt-popup {
  width: 200px;
  font-size: 12px;
  line-height: 1.4;
}

.admin-layout .gt-popup img {
  display: block;
  width: 100%;
  height: 110px;
  margin-bottom: 8px;
  border-radius: 3px;
  object-fit: cover;
}

.admin-layout .gt-popup-title {
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.admin-layout .gt-popup-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--muted);
}

.admin-layout .gt-popup-row i {
  width: 12px;
  text-align: center;
  font-size: 11px;
}

.admin-layout .gt-popup button {
  width: 100%;
  margin-top: 8px;
  padding: 6px;
  background: var(--accent);
  border: 0;
  border-radius: 3px;
  font-weight: 500;
  color: #fff;
}

.admin-layout .gt-popup button:hover {
  background: var(--accent-dark);
}

/* ============ RESPONSIF ============ */
@media (max-width: 1100px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .photo-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .map-panel {
    min-height: 420px;
  }

  .detail-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  .detail-actions {
    grid-column: 2;
  }

  .detail-photo {
    grid-row: 1 / span 2;
  }
}

@media (max-width: 900px) {
  .admin-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 2000;
    width: min(280px, 86vw);
    transform: translateX(-100%);
    visibility: hidden;
    transition: transform 0.2s ease, visibility 0.2s;
  }

  .nav-open .sidebar {
    transform: none;
    visibility: visible;
  }

  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1900;
    background: rgba(12, 18, 30, 0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }

  .nav-open .scrim {
    opacity: 1;
    pointer-events: auto;
  }

  .sidebar-close,
  .menu-toggle {
    display: inline-grid;
  }

  .content {
    padding: 16px;
  }
}

@media (max-width: 640px) {
  .stat {
    gap: 10px;
    padding: 12px 14px;
  }

  .stat-value {
    font-size: 20px;
  }

  .detail-body {
    display: flex;
  }

  .photo-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 12px;
  }

  .panel-head {
    padding: 10px 12px;
  }

  .map-panel {
    min-height: 380px;
  }

  .leaflet-map {
    min-height: 320px;
  }

  .fact {
    grid-template-columns: 96px minmax(0, 1fr);
  }
}

@media (max-width: 380px) {
  .photo-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar,
  .scrim {
    transition: none;
  }
}
</style>