import type { ExtensionFactory, View, ViewRow } from "titah-code/extension"
import { snapshot, type Snapshot } from "./git.ts"
import {
  moveCursor,
  nextSection,
  plan,
  SECTIONS,
  shortenPath,
  type Row,
  type SectionId,
} from "./sections.ts"

/**
 * Sidebar git bergaya lazygit untuk Titah: Files, Worktrees, Branches, Commits,
 * Stash — accordion, dengan kursor yang digerakkan panah.
 *
 * Ditulis HANYA dengan `titah-code/extension`. Bukan disiplin sukarela: `exports`
 * di package.json Titah menolak jalur lain. Kalau sidebar selengkap ini bisa
 * dibuat dengan permukaan itu saja, maka permukaan itu cukup untuk orang lain.
 *
 * # Hanya memantau
 *
 * Tidak ada checkout, tidak ada stage, tidak ada stash apply. Bukan karena belum
 * kesampaian — panel ini berjalan di dalam proses Titah TANPA melewati dialog
 * izin, jadi satu tekanan tombol yang mengubah working tree tidak akan pernah
 * ditanyakan kepada siapa pun. Dan working tree itu sedang dipakai agent yang
 * mungkin di tengah menyunting berkas.
 */

interface Options {
  /** Batas commit yang ditampilkan. Pembacaannya sendiri dibatasi COMMIT_LIMIT. */
  commitLimit?: number
  /** Kolom yang terbuka saat panel pertama kali digambar. */
  start?: SectionId
}

const EMPTY: Record<SectionId, string> = {
  files: "clean",
  worktrees: "none",
  branches: "no local branches",
  commits: "no commits",
  stash: "empty",
}

const factory: ExtensionFactory = ({ cwd, options }) => {
  const settings = options as Options
  const commitLimit = Math.max(1, settings.commitLimit ?? 50)

  let focused: SectionId = SECTIONS.some((section) => section.id === settings.start)
    ? (settings.start as SectionId)
    : "files"

  /*
   * Kursor per kolom, bukan satu kursor bersama.
   *
   * Kembali ke Branches sesudah menyusuri Commits harus mengembalikanmu ke baris
   * yang sama seperti saat kamu meninggalkannya. Satu kursor bersama membuat
   * setiap perpindahan kolom kehilangan tempat — dan pada daftar yang di-window,
   * itu juga memindahkan jendelanya.
   */
  const cursors: Record<SectionId, number> = {
    files: 0,
    worktrees: 0,
    branches: 0,
    commits: 0,
    stash: 0,
  }

  /** Panjang tiap daftar dari render TERAKHIR, dibaca penanganan tombol. */
  let counts: Record<SectionId, number> = { files: 0, worktrees: 0, branches: 0, commits: 0, stash: 0 }

  /** Peta baris terakhir yang digambar, supaya klik memakai susunan yang sama. */
  let drawn: Row[] = []

  return {
    title: "Git",
    side: "left",
    key: "<leader>g",

    async render({ signal, width, rows }): Promise<View> {
      const state = await snapshot({ cwd, signal })

      // Bukan repo git adalah keadaan yang SAH. Panel yang melaporkan "failed"
      // di folder biasa mengajari orang mengabaikan laporan gagal.
      if (state.branch === undefined && !state.detached) {
        drawn = []
        return { kind: "rows", rows: [{ text: "not a git repo", dim: true }] }
      }

      const lists = entriesFor(state, width, commitLimit)
      counts = {
        files: lists.files.length,
        worktrees: lists.worktrees.length,
        branches: lists.branches.length,
        commits: lists.commits.length,
        stash: lists.stash.length,
      }
      // Dijepit ulang setiap render: daftar bisa menyusut di antara dua render
      // (berkas di-commit, stash dibuang), dan kursor yang tertinggal di luar
      // batas akan menggambar penanda di baris yang tidak ada.
      cursors[focused] = moveCursor(cursors[focused], 0, counts[focused])

      drawn = plan({
        rows,
        counts,
        focused,
        cursor: cursors[focused],
        entries: lists[focused],
        emptyLabel: EMPTY[focused],
      })

      return { kind: "rows", rows: drawn.map((row) => draw(row, state)) }
    },

    onKey({ key }) {
      if (key === "tab") {
        focused = nextSection(focused)
        return { refresh: true }
      }
      if (key === "up" || key === "down") {
        /*
         * Jumlah entri dibaca dari render TERAKHIR, bukan dihitung ulang dari
         * git. Menghitung ulang di sini berarti memanggil git di penanganan
         * tombol — dan kursor akan menjepit terhadap daftar yang berbeda dari
         * yang sedang dilihat user.
         */
        cursors[focused] = moveCursor(cursors[focused], key === "up" ? -1 : 1, counts[focused])
        return { refresh: true }
      }
      if (key === "r") return { refresh: true }
      return undefined
    },

    onClick({ row }) {
      const target = drawn[row]
      if (target === undefined) return undefined

      // Klik pada judul membuka kolomnya — satu-satunya cara memilih kolom tanpa
      // memutar tab, dan judul adalah sasaran paling jelas di layar.
      if (target.kind === "header") {
        if (target.section === focused) return undefined
        focused = target.section
        return { refresh: true }
      }
      if (target.kind === "entry") {
        cursors[target.section] = target.index
        return { refresh: true }
      }
      return undefined
    },
  }
}

/**
 * Isi setiap kolom sebagai teks, sudah dipendekkan ke lebar panel.
 *
 * Dipendekkan DI SINI dan bukan diserahkan ke Titah, karena aturannya berbeda
 * per kolom: path dipotong dari DEPAN supaya nama berkasnya bertahan, sedangkan
 * subjek commit dipotong dari belakang karena awalannya yang bermakna.
 */
function entriesFor(state: Snapshot, width: number, commitLimit: number): Record<SectionId, string[]> {
  // Dua kolom dipakai penanda kursor "› ", jadi teksnya dapat sisanya.
  const inner = Math.max(1, width - 2)

  return {
    // Spasi di status diganti titik tengah: " M" dan "M " adalah dua keadaan
    // berbeda (worktree vs index), dan spasi di awal baris tidak terlihat.
    files: state.files.map((file) => `${file.status.replace(/ /g, "·")} ${shortenPath(file.path, inner - 3)}`),
    worktrees: state.worktrees.map((path) => shortenPath(path, inner)),
    branches: state.branches.map((branch) => shortenPath(branch, inner)),
    commits: state.commits.slice(0, commitLimit).map((line) => line.slice(0, inner)),
    stash: state.stash.map((line) => line.slice(0, inner)),
  }
}

/**
 * Satu baris peta jadi satu baris view.
 *
 * Judul yang fokus diberi WARNA, kursor diberi TEBAL — dua penanda berbeda untuk
 * dua hal berbeda. Keduanya tebal berarti mata tidak bisa membedakan "kolom ini
 * yang aktif" dari "baris ini yang tersorot", dan itu justru dua pertanyaan yang
 * dijawab sidebar ini.
 */
function draw(row: Row, state: Snapshot): ViewRow {
  switch (row.kind) {
    case "header": {
      const label = `${row.title} (${row.count})${row.section === "branches" ? headLabel(state) : ""}`
      return row.focused ? { text: label, color: "cyan" } : { text: label, dim: true }
    }
    case "entry":
      return row.cursor ? { text: `› ${row.text}`, selected: true } : { text: `  ${row.text}` }
    case "empty":
      return { text: `  ${row.text}`, dim: true }
    case "hint":
      return { text: row.text, dim: true }
  }
}

/**
 * Branch saat ini dan jarak ke remote, ditempel di judul Branches.
 *
 * Di judul dan bukan sebagai baris tersendiri: ini satu-satunya informasi yang
 * harus terlihat SAAT kolom lain yang terbuka, dan accordion tidak menyisakan
 * baris untuk itu. Angka nol dilewati — "↑0 ↓0" memakai ruang untuk mengatakan
 * bahwa tidak ada yang perlu dikatakan.
 */
function headLabel(state: Snapshot): string {
  const parts = [
    state.detached ? "detached" : state.branch,
    state.ahead > 0 ? `↑${state.ahead}` : "",
    state.behind > 0 ? `↓${state.behind}` : "",
  ].filter(Boolean)
  return parts.length > 0 ? ` ${parts.join(" ")}` : ""
}

export default factory
