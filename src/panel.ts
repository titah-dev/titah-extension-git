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

      return mode === "summary"
        ? { kind: "rows", rows: summaryRows(state, { branchLimit, showWorktrees }) }
        : { kind: "rows", rows: branchRows(state) }
    },

    onKey({ key }) {
      if (key === "b") {
        mode = mode === "summary" ? "branches" : "summary"
        return { refresh: true }
      }
      if (key === "r") return { refresh: true }
    },
  }
}

function summaryRows(state: Snapshot, limits: { branchLimit: number; showWorktrees: boolean }): ViewRow[] {
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

  const others = state.branches.filter((branch) => branch !== state.branch).slice(0, limits.branchLimit)
  if (others.length > 0) {
    rows.push({ text: "", dim: true })
    for (const branch of others) rows.push({ text: branch, dim: true })
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
  rows.push({ text: "b branches · r refresh", dim: true })
  return rows
}

function branchRows(state: Snapshot): ViewRow[] {
  if (state.branches.length === 0) return [{ text: "no local branches", dim: true }]
  return [
    ...state.branches.map((branch) => ({
      text: branch,
      ...(branch === state.branch ? { selected: true } : { dim: true }),
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
