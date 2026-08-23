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

export interface FileChange {
  /** Dua huruf XY dari `--porcelain=v1`, mis. " M", "A ", "??". */
  status: string
  path: string
}

export interface Snapshot {
  /** `undefined` kalau ini bukan repo git. */
  branch?: string
  detached: boolean
  files: FileChange[]
  branches: string[]
  worktrees: string[]
  commits: string[]
  stash: string[]
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
/** Berapa commit terakhir yang dibaca. Lebih dari ini tidak pernah terlihat. */
export const COMMIT_LIMIT = 50

export async function snapshot(options: RunOptions): Promise<Snapshot> {
  const empty: Snapshot = {
    detached: false,
    files: [],
    branches: [],
    worktrees: [],
    commits: [],
    stash: [],
    ahead: 0,
    behind: 0,
  }

  const [head, branches, worktrees, status, log, stash] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"], options),
    git(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"], options),
    git(["worktree", "list", "--porcelain"], options),
    git(["status", "--porcelain=v1", "--branch"], options),
    /*
     * `--no-decorate` supaya keluarannya tidak berubah bentuk pada repo yang
     * punya banyak ref di HEAD. Dan dibatasi COMMIT_LIMIT: panel tiga puluh
     * kolom tidak akan pernah menampilkan lebih dari itu, jadi membacanya berarti
     * membayar untuk baris yang tidak bisa dilihat siapa pun.
     */
    git(["log", "--no-decorate", `--max-count=${COMMIT_LIMIT}`, "--format=%h %s"], options),
    git(["stash", "list", "--format=%gd %s"], options),
  ])

  if (!head.ok) return empty

  const name = head.stdout.trim()
  const detached = name === "HEAD"

  return {
    ...empty,
    ...(detached ? {} : { branch: name }),
    detached,
    files: parseStatus(status.stdout),
    branches: currentFirst(lines(branches.stdout), detached ? undefined : name),
    worktrees: lines(worktrees.stdout)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length)),
    /*
     * `log` yang gagal DIBIARKAN kosong, bukan menggagalkan seluruh snapshot.
     * Repo yang baru `git init` belum punya commit sama sekali, dan itu keadaan
     * yang sah — `rev-parse HEAD` juga gagal di situ, jadi `head.ok` sudah
     * menangkapnya, tapi repo dengan HEAD tanpa commit tetap mungkin.
     */
    commits: lines(log.stdout),
    stash: lines(stash.stdout),
    ...parseTracking(status.stdout),
  }
}

/**
 * Mengurai `--porcelain=v1` jadi status dua huruf dan path.
 *
 * Baris `##` milik `--branch` dibuang di sini, satu kali. Menghitungnya sebagai
 * berkas membuat repo yang bersih selalu melaporkan satu perubahan — dan tidak
 * ada yang curiga pada angka satu.
 *
 * Rename datang sebagai `R  lama -> baru`. Yang disimpan adalah nama BARU:
 * itu berkas yang ada sekarang, dan itu yang dicari orang di daftar.
 */
export function parseStatus(output: string): FileChange[] {
  return lines(output)
    .filter((line) => !line.startsWith("##"))
    .map((line) => {
      const status = line.slice(0, 2)
      const rest = line.slice(3)
      const arrow = rest.indexOf(" -> ")
      return { status, path: arrow === -1 ? rest : rest.slice(arrow + 4) }
    })
}

/**
 * Branch saat ini ditaruh paling depan, sisanya tetap urutan committerdate.
 *
 * `--sort=-committerdate` mengurutkan berdasarkan tanggal commit, dan pada repo
 * yang branch-nya menunjuk commit yang sama urutannya jadi sembarang — jadi
 * branch yang sedang dipakai bisa mendarat di urutan keempat. Di panel accordion
 * yang hanya punya tiga baris, itu berarti "branch apa yang sedang saya pakai"
 * tergeser keluar layar. Diukur pada repo demo: `Branches (4)` menampilkan tiga,
 * dan yang hilang adalah `main`.
 */
export function currentFirst(branches: string[], current: string | undefined): string[] {
  if (current === undefined || !branches.includes(current)) return branches
  return [current, ...branches.filter((branch) => branch !== current)]
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
