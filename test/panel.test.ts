import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import type { View, ViewRow } from "titah-code/extension"
import factory from "../src/panel.ts"
import { snapshot } from "../src/git.ts"

/**
 * Repo sungguhan, bukan git yang dipalsukan.
 *
 * Memalsukan keluaran git berarti menguji tebakan kita tentang formatnya. Yang
 * benar-benar gagal di lapangan adalah format itu sendiri — `--porcelain=v1`
 * yang berbeda antar versi, baris `##` yang muncul atau tidak — dan tebakan
 * tidak bisa menangkapnya.
 */
function repo(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-"))
  const run = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, env: { ...process.env, LC_ALL: "C" }, stdio: "pipe" })

  run("init", "-q", "-b", "main")
  run("config", "user.email", "test@example.com")
  run("config", "user.name", "Test")
  fs.writeFileSync(path.join(directory, "a.txt"), "a\n")
  run("add", "a.txt")
  run("commit", "-q", "-m", "first")
  return directory
}

const request = { signal: AbortSignal.timeout(10_000), width: 16, rows: 12 }

function rowsOf(view: View): ViewRow[] {
  assert.equal(view.kind, "rows")
  return view.kind === "rows" ? view.rows : []
}

async function open(cwd: string, options: Record<string, unknown> = {}) {
  return await factory({ cwd, options })
}

test("branch saat ini jadi baris pertama dan ditandai terpilih", async () => {
  const panel = await open(repo())
  const rows = rowsOf(await panel.render(request))
  assert.equal(rows[0]?.text, "main")
  assert.equal(rows[0]?.selected, true)
})

test("direktori yang bukan repo git bukan kegagalan", async () => {
  /*
   * Orang membuka Titah di folder mana pun. Panel yang melaporkan "failed" di
   * folder biasa mengajari orang mengabaikan laporan gagal — termasuk yang
   * sungguhan.
   */
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-repo-"))
  const rows = rowsOf(await (await open(plain)).render(request))
  assert.deepEqual(rows, [{ text: "not a git repo", dim: true }])
})

test("berkas yang berubah dihitung, dan baris ## tidak ikut dihitung", async () => {
  /*
   * `git status --porcelain=v1 --branch` menambahkan satu baris `## main` di
   * atas. Menghitungnya membuat repo yang bersih melaporkan satu berkas berubah
   * — selalu, dan tanpa ada yang curiga pada angka satu.
   */
  const directory = repo()
  const rows = rowsOf(await (await open(directory)).render(request))
  assert.ok(!rows.some((row) => row.text.includes("changed")), JSON.stringify(rows))

  fs.writeFileSync(path.join(directory, "b.txt"), "b\n")
  const dirty = rowsOf(await (await open(directory)).render(request))
  assert.ok(dirty.some((row) => row.text.includes("1 changed")), JSON.stringify(dirty))
})

test("angka nol tidak memakan baris", async () => {
  // Di panel enam belas kolom, ruang lebih berharga daripada kelengkapan.
  const rows = rowsOf(await (await open(repo())).render(request))
  assert.ok(!rows.some((row) => row.text.includes("↑0") || row.text.includes("↓0")))
})

test("branch lain ditampilkan redup, dan dibatasi branchLimit", async () => {
  const directory = repo()
  const run = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "pipe" })
  for (const name of ["x", "y", "z"]) run("branch", name)

  const rows = rowsOf(await (await open(directory, { branchLimit: 2 })).render(request))
  const others = rows.filter((row) => ["x", "y", "z"].includes(row.text))
  assert.equal(others.length, 2)
  assert.ok(others.every((row) => row.dim === true))
})

test("satu worktree TIDAK menampilkan daftar worktree", async () => {
  // Satu worktree berarti tidak ada yang memakai worktree — itu repo biasa, dan
  // daftar berisi satu baris hanya membuang ruang.
  const rows = rowsOf(await (await open(repo())).render(request))
  assert.ok(!rows.some((row) => row.text.includes("worktrees")), JSON.stringify(rows))
})

test("worktree kedua memunculkan daftarnya", async () => {
  const directory = repo()
  const extra = path.join(directory, "..", `wt-${path.basename(directory)}`)
  execFileSync("git", ["worktree", "add", "-q", "-b", "side", extra], { cwd: directory, stdio: "pipe" })

  const rows = rowsOf(await (await open(directory)).render(request))
  assert.ok(rows.some((row) => row.text.includes("2 worktrees")), JSON.stringify(rows))

  execFileSync("git", ["worktree", "remove", "--force", extra], { cwd: directory, stdio: "pipe" })
})

test("worktrees: false mematikan daftarnya meski ada dua", async () => {
  const directory = repo()
  const extra = path.join(directory, "..", `wt2-${path.basename(directory)}`)
  execFileSync("git", ["worktree", "add", "-q", "-b", "side2", extra], { cwd: directory, stdio: "pipe" })

  const rows = rowsOf(await (await open(directory, { worktrees: false })).render(request))
  assert.ok(!rows.some((row) => row.text.includes("worktrees")))

  execFileSync("git", ["worktree", "remove", "--force", extra], { cwd: directory, stdio: "pipe" })
})

test("tombol b berpindah ke daftar branch penuh dan kembali", async () => {
  const directory = repo()
  execFileSync("git", ["branch", "other"], { cwd: directory, stdio: "pipe" })
  const panel = await open(directory, { branchLimit: 1 })

  assert.equal(panel.onKey?.({ key: "b" })?.refresh, true)
  const full = rowsOf(await panel.render(request))
  assert.ok(full.some((row) => row.text === "b back"), JSON.stringify(full))

  assert.equal(panel.onKey?.({ key: "b" })?.refresh, true)
  const back = rowsOf(await panel.render(request))
  assert.ok(back.some((row) => row.text.includes("b branches")), JSON.stringify(back))
})

test("tombol r meminta refresh, tombol lain tidak", async () => {
  const panel = await open(repo())
  assert.equal(panel.onKey?.({ key: "r" })?.refresh, true)
  assert.equal(panel.onKey?.({ key: "q" }), undefined)
})

test("HEAD yang detached dikatakan apa adanya", async () => {
  const directory = repo()
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, stdio: "pipe" }).toString().trim()
  execFileSync("git", ["checkout", "-q", sha], { cwd: directory, stdio: "pipe" })

  const rows = rowsOf(await (await open(directory)).render(request))
  assert.equal(rows[0]?.text, "detached HEAD")
})

test("signal yang sudah dibatalkan tidak menggantung dan tidak melempar", async () => {
  /*
   * Titah membatalkan render saat panel ditutup atau saat timeout habis. Panel
   * yang melempar di situ mengubah pembatalan yang normal jadi laporan gagal.
   */
  const rows = rowsOf(await (await open(repo())).render({ ...request, signal: AbortSignal.abort() }))
  assert.deepEqual(rows, [{ text: "not a git repo", dim: true }])
})

test("snapshot menjalankan perintahnya bersamaan, bukan berurutan", async () => {
  /*
   * Batas waktu Titah dua detik. Berurutan, panel pada repo besar menunggu
   * jumlah dari empat perintah — jadi penungguan yang lolos di repo kecil akan
   * timeout di repo yang justru paling butuh panel ini.
   *
   * Diukur, bukan dibaca dari kode: empat panggilan git berurutan pada repo
   * sekecil ini pun terukur lebih lambat dari satu putaran bersamaan.
   */
  const directory = repo()
  const signal = AbortSignal.timeout(10_000)
  const started = process.hrtime.bigint()
  await snapshot({ cwd: directory, signal })
  const parallelMs = Number(process.hrtime.bigint() - started) / 1e6

  const serialStart = process.hrtime.bigint()
  for (let index = 0; index < 4; index++) await snapshot({ cwd: directory, signal })
  const serialMs = Number(process.hrtime.bigint() - serialStart) / 1e6

  assert.ok(parallelMs < serialMs, `bersamaan ${parallelMs}ms tidak lebih cepat dari ${serialMs}ms`)
})

test("klik pada baris branch menyorotinya, dan klik lagi melepasnya", async () => {
  const directory = repo()
  execFileSync("git", ["branch", "target"], { cwd: directory, stdio: "pipe" })
  const panel = await open(directory)

  const before = rowsOf(await panel.render(request))
  const index = before.findIndex((row) => row.text === "target")
  assert.ok(index > 0, "baris target harus ada")

  assert.equal(panel.onClick?.({ row: index })?.refresh, true)
  const after = rowsOf(await panel.render(request))
  assert.equal(after[index]?.selected, true)
  assert.equal(after[index]?.dim, undefined)

  assert.equal(panel.onClick?.({ row: index })?.refresh, true)
  const off = rowsOf(await panel.render(request))
  assert.equal(off[index]?.selected, undefined)
  assert.equal(off[index]?.dim, true)
})

test("klik pada baris yang BUKAN branch tidak melakukan apa pun", async () => {
  /*
   * Panel menyisipkan baris kosong, baris hitungan, dan baris petunjuk di antara
   * branch-nya. Tanpa peta baris, klik pada baris pemisah akan memilih branch
   * yang salah tanpa satu pun tanda bahwa ia salah.
   */
  const panel = await open(repo())
  const rows = rowsOf(await panel.render(request))
  const hint = rows.findIndex((row) => row.text.includes("b branches"))
  assert.ok(hint > 0, "baris petunjuk harus ada")
  assert.equal(panel.onClick?.({ row: hint }), undefined)

  const blank = rows.findIndex((row) => row.text === "")
  assert.ok(blank > 0, "baris pemisah harus ada")
  assert.equal(panel.onClick?.({ row: blank }), undefined)

  // Baris 0 adalah branch saat ini — itu baris branch yang SAH, jadi klik di
  // sana memang bekerja. Yang tidak boleh bekerja hanyalah baris yang bukan
  // branch.
  assert.deepEqual(panel.onClick?.({ row: 0 }), { refresh: true })
})

test("klik di luar batas baris tidak melempar", async () => {
  // Titah sudah menjepit indeksnya, tapi extension tidak boleh bergantung pada
  // itu: satu perubahan tinggi panel di sisi Titah tidak boleh melempar di sini.
  const panel = await open(repo())
  await panel.render(request)
  assert.equal(panel.onClick?.({ row: 999 }), undefined)
  assert.equal(panel.onClick?.({ row: -1 }), undefined)
})

test("klik tetap bekerja di tampilan daftar branch penuh", async () => {
  const directory = repo()
  execFileSync("git", ["branch", "other"], { cwd: directory, stdio: "pipe" })
  const panel = await open(directory)
  await panel.render(request)
  panel.onKey?.({ key: "b" })

  const rows = rowsOf(await panel.render(request))
  const index = rows.findIndex((row) => row.text === "other")
  assert.ok(index >= 0)
  panel.onClick?.({ row: index })
  const after = rowsOf(await panel.render(request))
  assert.equal(after[index]?.selected, true)
})
