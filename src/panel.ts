import type { ExtensionFactory, View, ViewRow } from "titah-code/extension"
import { snapshot, type Snapshot } from "./git.ts"

/**
 * Panel git untuk Titah.
 *
 * Ditulis HANYA dengan `titah-code/extension`. Tidak ada satu pun import dari
 * dalam Titah, dan itu bukan disiplin sukarela — `exports` di `package.json`
 * Titah menolak jalur lain. Kalau panel ini bisa dibuat berguna dengan
 * permukaan itu saja, maka permukaan itu cukup untuk orang lain juga; kalau
 * tidak, yang harus diperbaiki adalah permukaannya.
 */

interface Options {
  /** Batas jumlah branch yang ditampilkan. */
  branchLimit?: number
  /** Tampilkan daftar worktree. Mati kalau kamu tidak memakai worktree. */
  worktrees?: boolean
}

/**
 * Dua tampilan, satu tombol.
 *
 * `summary` yang dibuka pertama karena itu yang dilihat orang sepanjang hari;
 * `branches` di belakang satu tekanan karena daftar penuh hanya dibutuhkan saat
 * benar-benar mencari sesuatu.
 */
type Mode = "summary" | "branches"

const factory: ExtensionFactory = ({ cwd, options }) => {
  const settings = options as Options
  const branchLimit = Math.max(1, settings.branchLimit ?? 12)
  const showWorktrees = settings.worktrees !== false

  let mode: Mode = "summary"

  /*
   * Baris terakhir yang digambar, disimpan supaya klik bisa dipetakan.
   *
   * Titah memberi INDEKS BARIS YANG DIGAMBAR, bukan indeks branch — dan panel
   * ini menyisipkan baris kosong, baris hitungan, dan baris petunjuk di antara
   * branch-nya. Tanpa peta ini, klik pada branch kedua akan mengenai baris
   * pemisah dan tidak melakukan apa pun, atau lebih buruk: memilih branch yang
   * salah tanpa satu pun tanda bahwa ia salah.
   */
  let drawn: (string | undefined)[] = []
  let selected: string | undefined

  return {
    title: "Git",
    side: "left",
    key: "<leader>g",

    async render({ signal }): Promise<View> {
      const state = await snapshot({ cwd, signal })

      // Bukan repo git adalah keadaan yang SAH, bukan kegagalan. Panel yang
      // melaporkan "failed" di folder biasa mengajari orang mengabaikan
      // laporan gagal.
      if (state.branch === undefined && !state.detached) {
        return { kind: "rows", rows: [{ text: "not a git repo", dim: true }] }
      }

      const rows =
        mode === "summary"
          ? summaryRows(state, { branchLimit, showWorktrees, selected })
          : branchRows(state, selected)

      // Peta klik dibangun dari baris yang SAMA dengan yang dikembalikan, bukan
      // dihitung ulang dari state — dua sumber untuk satu daftar akan menyimpang
      // tepat saat jumlah barisnya berubah.
      drawn = rows.map((row) => (state.branches.includes(row.text) ? row.text : undefined))
      return { kind: "rows", rows }
    },

    onKey({ key }) {
      if (key === "b") {
        mode = mode === "summary" ? "branches" : "summary"
        return { refresh: true }
      }
      if (key === "r") return { refresh: true }
    },

    /*
     * Klik pada baris branch menyorotinya. TIDAK melakukan checkout.
     *
     * Checkout dari satu klik mengubah working tree di bawah agent yang mungkin
     * sedang menyunting berkas — dan panel ini berjalan tanpa melewati dialog
     * izin Titah, jadi tidak ada apa pun yang akan menanyakannya lebih dulu.
     * Menyorot adalah yang paling jauh yang boleh dilakukan tanpa izin.
     */
    onClick({ row }) {
      const branch = drawn[row]
      if (branch === undefined) return
      selected = selected === branch ? undefined : branch
      return { refresh: true }
    },
  }
}

function summaryRows(
  state: Snapshot,
  limits: { branchLimit: number; showWorktrees: boolean; selected?: string },
): ViewRow[] {
  const rows: ViewRow[] = [
    { text: state.detached ? "detached HEAD" : (state.branch ?? ""), selected: true },
  ]

  /*
   * Angka nol tidak ditampilkan.
   *
   * "0 changed · 0 ahead" memakai tiga dari lima baris panel untuk mengatakan
   * bahwa tidak ada yang perlu dikatakan — di panel enam belas kolom, ruang itu
   * lebih berharga daripada kelengkapan.
   */
  const tally = [
    state.changed > 0 ? `${state.changed} changed` : "",
    state.ahead > 0 ? `↑${state.ahead}` : "",
    state.behind > 0 ? `↓${state.behind}` : "",
  ].filter(Boolean)
  if (tally.length > 0) rows.push({ text: tally.join(" · "), color: "yellow" })

  const candidates = state.branches.filter((branch) => branch !== state.branch)
  const others = candidates.slice(0, limits.branchLimit)
  const hidden = candidates.length - others.length
  if (others.length > 0) {
    rows.push({ text: "", dim: true })
    for (const branch of others) {
      rows.push(branch === limits.selected ? { text: branch, selected: true } : { text: branch, dim: true })
    }
  }

  // Satu worktree berarti tidak ada yang memakai worktree — itu repo biasa, dan
  // menampilkan daftar berisi satu baris hanya membuang ruang.
  if (limits.showWorktrees && state.worktrees.length > 1) {
    rows.push({ text: "", dim: true })
    rows.push({ text: `${state.worktrees.length} worktrees`, dim: true })
    for (const worktree of state.worktrees) {
      rows.push({ text: basename(worktree), dim: true })
    }
  }

  rows.push({ text: "", dim: true })
  /*
   * `b` diiklankan HANYA kalau ada branch yang tidak terlihat.
   *
   * Diukur, bukan diduga: dengan `branchLimit` bawaan 12, repo biasa
   * menampilkan SELURUH branch-nya di summary — jadi mode `branches` tidak
   * membawa satu pun branch tambahan, dan `b` hanya membuang baris hitungan
   * lalu mengurutkan ulang. Tombol yang diiklankan tapi tidak menghasilkan apa
   * pun mengajari orang bahwa petunjuk di panel ini tidak bisa dipercaya, dan
   * itu merugikan `r` juga.
   *
   * Tombolnya tetap BEKERJA saat tidak diiklankan. Itu arah kesalahan yang
   * benar: tombol yang ada tanpa dijanjikan hanya kejutan kecil, sedangkan
   * tombol yang dijanjikan tanpa ada adalah janji yang dilanggar.
   */
  rows.push({ text: hidden > 0 ? `b +${hidden} more · r refresh` : "r refresh", dim: true })
  return rows
}

function branchRows(state: Snapshot, selected?: string): ViewRow[] {
  if (state.branches.length === 0) return [{ text: "no local branches", dim: true }]
  return [
    ...state.branches.map((branch) => ({
      text: branch,
      ...(branch === state.branch || branch === selected ? { selected: true } : { dim: true }),
    })),
    { text: "", dim: true },
    { text: "b back", dim: true },
  ]
}

/**
 * Nama direktori terakhir dari sebuah path.
 *
 * Ditulis tangan alih-alih memakai `node:path` supaya modul ini tidak punya
 * ketergantungan runtime sama sekali — panel yang gagal karena resolusi modul
 * adalah panel yang gagal untuk alasan yang tidak ada hubungannya dengan git.
 */
function basename(value: string): string {
  const parts = value.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? value
}

export default factory
