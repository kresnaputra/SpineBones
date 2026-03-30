# SpineWeb

SpineWeb adalah editor skeleton 2D berbasis web untuk membuat rig sederhana, menambahkan attachment gambar, mengatur keyframe animasi, lalu mengekspor hasilnya ke format project JSON, paket Spine-like, atau video.

## Fitur Utama

- Membuat dan menyusun hirarki bone langsung di canvas
- Mengatur posisi, rotasi, scale, parent, dan panjang bone
- Menambahkan slot dan upload attachment gambar per bone
- Mengelola skin aktif
- Membuat animasi keyframe per bone di timeline
- Undo/redo perubahan
- Import dan simpan project dalam format JSON
- Export ke paket Spine (`.zip` berisi `skeleton.json`, `atlas.atlas`, dan image attachment)
- Export animasi ke video `WebM`
- Menambahkan background image sebagai referensi animasi

## Teknologi

- React 19
- TypeScript
- Vite
- Zustand
- Tailwind CSS 4

## Requirement

- Bun atau Node.js modern
- Browser modern yang mendukung Canvas API, File API, dan `MediaRecorder`

## Instalasi

Disarankan memakai Bun karena repo ini sudah menyertakan `bun.lock`.

```bash
bun install
```

Kalau ingin memakai npm:

```bash
npm install
```

## Menjalankan Aplikasi

Mode development:

```bash
bun run dev
```

atau:

```bash
npm run dev
```

Build production:

```bash
bun run build
```

Preview hasil build:

```bash
bun run preview
```

Lint:

```bash
bun run lint
```

## Struktur Antarmuka

Saat aplikasi dibuka, editor akan menampilkan demo skeleton otomatis jika project masih kosong.

- Toolbar atas: pilih tool, undo/redo, keyframe, skin, save/load, export, dan mode editor
- Panel kiri: bone list, slot per bone, dan daftar skin
- Canvas tengah: area menggambar skeleton, pose, dan melihat attachment
- Panel kanan: properti bone dan attachment aktif
- Timeline bawah: playback animasi, frame control, fps, duration, dan keyframe per bone
- Status bar: ringkasan shortcut penting

## Cara Penggunaan

### 1. Membuat Bone

1. Jalankan aplikasi.
2. Pilih tool `Bone` atau tekan `B`.
3. Klik di canvas untuk membuat bone baru.
4. Klik bone yang sudah ada saat membuat bone baru jika ingin menjadikannya parent.

Catatan:

- Bone baru akan mengikuti skin yang sedang aktif.
- Bone dapat dipilih dari canvas atau dari panel `Bones`.
- Urutan bone di panel kiri bisa di-drag untuk diubah.

### 2. Mengedit Bone

Pilih sebuah bone, lalu gunakan:

- Tool `Pose` (`Q`) untuk memilih dan memindahkan seperti manipulasi umum
- Tool `Move` (`M`) untuk menggeser posisi bone
- Tool `Rotate` (`R`) untuk memutar bone
- Tool `Scale` (`S`) untuk mengubah skala bone
- Panel `Properties` untuk mengubah nama, posisi, panjang, rotasi, scale, dan parent secara presisi

### 3. Menambahkan Slot dan Attachment

1. Pilih bone yang ingin diberi gambar.
2. Di panel `Slots`, klik tombol `+`.
3. Isi nama slot.
4. Klik ikon upload pada slot.
5. Pilih file gambar dari komputer.

Setelah attachment aktif, panel kanan akan menampilkan pengaturan:

- `Offset X`
- `Offset Y`
- `Rotation`
- `Scale X`
- `Scale Y`

Pengaturan ini berguna untuk menyesuaikan posisi pivot dan tampilan gambar terhadap bone.

### 4. Mengelola Skin

- Daftar skin ada di panel `Skins`
- Klik skin untuk menjadikannya skin aktif
- Gunakan tombol `Add Skin` di toolbar untuk menambah skin baru

### 5. Membuat Animasi

1. Klik tombol mode `ANIMATE` di kanan toolbar.
2. Pilih bone yang ingin dianimasikan.
3. Geser frame aktif di timeline.
4. Ubah posisi, rotasi, atau scale bone.
5. Tekan `K` atau klik tombol `Key` untuk menyimpan keyframe.

Fitur timeline:

- `Play/Pause` untuk preview animasi
- `Stop` untuk kembali ke frame 0
- `Prev/Next Key` untuk pindah antar keyframe pada bone terpilih
- `Clear` untuk menghapus semua keyframe bone terpilih
- `Loop` untuk menyalin keyframe pertama ke frame aktif agar transisi loop lebih halus
- Ubah `FPS` dan `Duration` langsung dari panel timeline

Interpolasi antar keyframe berjalan linear untuk:

- posisi `x`
- posisi `y`
- `rotation`
- `scaleX`
- `scaleY`

### 6. Menambahkan Background Referensi

- Klik `Background` di toolbar untuk upload gambar referensi
- Klik `Remove BG` untuk menghapus background

Background hanya dipakai sebagai referensi visual di editor dan juga bisa ikut masuk saat export video.

## Shortcut Keyboard

- `Q`: Pose tool
- `B`: Bone tool
- `M`: Move tool
- `R`: Rotate tool
- `S`: Scale tool
- `K`: Insert keyframe
- `Space`: Play/Pause animasi
- `Delete` / `Backspace`: Hapus bone terpilih
- `Esc`: Batalkan seleksi bone
- `Arrow Left` / `Arrow Right`: Pindah frame
- `Ctrl/Cmd + Z`: Undo
- `Ctrl/Cmd + Shift + Z` atau `Ctrl/Cmd + Y`: Redo
- Klik kanan + drag di canvas: Pan camera
- Scroll mouse: Zoom camera
- Double click keyframe di timeline: Hapus keyframe
- Tombol `X` atau `Delete` saat hover keyframe: Hapus keyframe

## Save, Load, dan Export

### Save Project

Tombol `Save` akan mengunduh file `spine-project.json` yang berisi:

- bones
- skins
- slots
- attachments
- keyframes
- duration
- fps

### Load Project

Tombol `Load` menerima file `.json` project yang sebelumnya disimpan dari aplikasi ini.

### Export Spine

Tombol `Export Spine` menghasilkan file `spine-export.zip` yang berisi:

- `skeleton.json`
- `atlas.atlas`
- file PNG untuk setiap attachment

Format ini ditujukan sebagai export ringan yang kompatibel untuk workflow mirip Spine, termasuk penggunaan di renderer seperti PixiJS Spine.

### Export Video

Tombol `Export Video` akan menghasilkan file `spine-animation.webm`.

Catatan:

- Export video memakai `MediaRecorder`
- Hasil terbaik bergantung pada dukungan browser
- Jika browser tidak mendukung codec tertentu, sistem akan mencoba fallback format yang tersedia

## Catatan Penggunaan

- Data aplikasi saat ini dikelola di state lokal browser selama sesi berjalan
- File project harus disimpan manual jika ingin dipakai lagi nanti
- Aplikasi otomatis memuat demo skeleton saat state masih kosong
- Menghapus bone parent juga akan menghapus child bone yang terhubung

## Struktur Script

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview"
}
```

## Pengembangan Lanjutan

Beberapa area yang bisa dikembangkan lagi:

- import asset batch
- pengaturan draw order dari UI
- dukungan easing timeline
- export/import format Spine yang lebih lengkap
- autosave project
- multi-animation management
