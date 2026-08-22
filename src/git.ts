import { execFile } from "node:child_process"

/**
 * Pemanggilan git, dipisah dari panel supaya bisa diuji terhadap repo sungguhan
 * tanpa merender apa pun.
 *
 * Setiap perintah memakai `--no-optional-locks` dan tidak pernah menulis. Panel
 * yang dibuka sambil `git rebase` berjalan tidak boleh menyentuh `.git/index.lock`
 * — satu panel yang menyegarkan diri di saat yang salah bisa menggagalkan rebase
 * orang, dan itu kerusakan yang tidak akan pernah dihubungkan ke panel.
 */

export interface RunResult {
  stdout: string
  ok: boolean
}

export interface RunOptions {
  cwd: string
  signal: AbortSignal
  /** Batas keluaran. Repo dengan ribuan branch tidak boleh memakan memori. */
  maxBuffer?: number
}

export function git(args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["--no-optional-locks", ...args],
      {
        cwd: options.cwd,
        signal: options.signal,
        maxBuffer: options.maxBuffer ?? 1024 * 1024,
        // Bahasa dipaksa C supaya keluaran git tidak berubah mengikuti locale
        // mesin. Tanpa ini, panel bekerja di mesin penulisnya dan menampilkan
        // baris kosong di mesin orang yang memakai locale lain.
        env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, stdout) => {
        /*
         * Kegagalan dikembalikan sebagai `ok: false`, bukan dilempar.
         *
         * Direktori yang bukan repo git adalah keadaan yang SAH — orang membuka
         * Titah di folder mana pun. Melemparnya membuat panel melaporkan
         * "failed" untuk sesuatu yang tidak gagal, dan pesan itu menutupi
         * kegagalan yang sungguhan.
         */
        if (error) return resolve({ stdout: "", ok: false })
        resolve({ stdout, ok: true })
      },
    )
  })
}

export interface Snapshot {
  /** `undefined` kalau ini bukan repo git. */
  branch?: string
  detached: boolean
  branches: string[]
  worktrees: string[]
  changed: number
  ahead: number
  behind: number
}

/**
 * Satu bacaan keadaan repo.
 *
 * Semua perintah dijalankan BERSAMAAN. Berurutan, panel pada repo besar
 * menunggu jumlah dari keempatnya — dan batas waktu Titah dua detik, jadi
 * penungguan berurutan yang lolos di repo kecil akan timeout di repo yang justru
 * paling butuh panel ini.
 */
export async function snapshot(options: RunOptions): Promise<Snapshot> {
  const [head, branches, worktrees, status] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"], options),
    git(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"], options),
    git(["worktree", "list", "--porcelain"], options),
    git(["status", "--porcelain=v1", "--branch"], options),
  ])

  if (!head.ok) {
    return { detached: false, branches: [], worktrees: [], changed: 0, ahead: 0, behind: 0 }
  }

  const name = head.stdout.trim()
  const detached = name === "HEAD"
  const tracking = parseTracking(status.stdout)

  return {
    ...(detached ? {} : { branch: name }),
    detached,
    branches: lines(branches.stdout),
    worktrees: lines(worktrees.stdout)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length)),
    // Baris `##` milik `--branch` tidak dihitung sebagai berkas yang berubah.
    changed: lines(status.stdout).filter((line) => !line.startsWith("##")).length,
    ...tracking,
  }
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "")
}

/**
 * Membaca `ahead`/`behind` dari baris `##` milik `git status --branch`.
 *
 * Dari sana dan bukan dari `rev-list --count` terpisah: itu perintah kelima yang
 * menjawab hal yang sudah dijawab perintah keempat, dan dua sumber untuk satu
 * angka akan menyimpang tepat saat remote-nya baru berubah.
 */
function parseTracking(status: string): { ahead: number; behind: number } {
  const header = status.split("\n").find((line) => line.startsWith("## "))
  if (header === undefined) return { ahead: 0, behind: 0 }
  const ahead = /\[.*?ahead (\d+)/.exec(header)
  const behind = /\[.*?behind (\d+)/.exec(header)
  return { ahead: Number(ahead?.[1] ?? 0), behind: Number(behind?.[1] ?? 0) }
}
