import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import type { View, ViewRow } from "titah-code/extension"
import factory from "../src/panel.ts"
import { currentFirst, parseStatus, snapshot } from "../src/git.ts"

/**
 * Repo sungguhan, bukan git yang dipalsukan.
 *
 * Memalsukan keluaran git berarti menguji tebakan kita tentang formatnya. Yang
 * benar-benar berbeda di lapangan adalah format itu sendiri — `--porcelain=v1`
 * antar versi git, baris `##` yang muncul atau tidak, `%gd` di stash — dan
 * tebakan tidak bisa menangkapnya.
 */
function repo(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-"))
  git(directory, "init", "-q", "-b", "main")
  git(directory, "config", "user.email", "test@example.com")
  git(directory, "config", "user.name", "Test")
  fs.writeFileSync(path.join(directory, "a.txt"), "a\n")
  git(directory, "add", "a.txt")
  git(directory, "commit", "-q", "-m", "first")
  return directory
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: { ...process.env, LC_ALL: "C" }, stdio: "pipe" }).toString()
}

/** Panel 34 kolom → 30 di dalam bingkai, 20 baris isi. Bawaan yang dianjurkan. */
const request = { signal: AbortSignal.timeout(10_000), width: 30, rows: 20 }

function rowsOf(view: View): ViewRow[] {
  assert.equal(view.kind, "rows")
  return view.kind === "rows" ? view.rows : []
}

async function open(cwd: string, options: Record<string, unknown> = {}) {
  return await factory({ cwd, options })
}

const texts = (rows: ViewRow[]): string[] => rows.map((row) => row.text)
const headerIndex = (rows: ViewRow[], title: string) => texts(rows).findIndex((text) => text.startsWith(title))

test("kelima kolom digambar dengan jumlahnya, dan Files terbuka lebih dulu", async () => {
  const directory = repo()
  fs.writeFileSync(path.join(directory, "b.txt"), "b\n")
  const rows = rowsOf(await (await open(directory)).render(request))

  for (const title of ["Files", "Worktrees", "Branches", "Commits", "Stash"]) {
    assert.ok(headerIndex(rows, title) >= 0, `judul ${title} harus ada: ${JSON.stringify(texts(rows))}`)
  }
  assert.ok(texts(rows)[0]?.startsWith("Files (1)"), texts(rows)[0])
  assert.match(texts(rows)[1] ?? "", /b\.txt/)
})

test("hanya satu judul berwarna — kolom yang aktif", async () => {
  // Warna untuk "kolom ini aktif", tebal untuk "baris ini tersorot". Keduanya
  // tebal berarti mata tidak bisa membedakan dua pertanyaan yang justru dijawab
  // sidebar ini.
  const rows = rowsOf(await (await open(repo())).render(request))
  const colored = rows.filter((row) => row.color === "cyan")
  assert.equal(colored.length, 1)
  assert.ok(colored[0]?.text.startsWith("Files"))
})

test("judul Branches membawa branch saat ini, supaya terlihat saat kolom lain terbuka", async () => {
  /*
   * Accordion tidak menyisakan baris untuk itu, dan "branch apa yang sedang saya
   * pakai" adalah satu-satunya informasi yang harus terlihat sepanjang waktu.
   */
  const rows = rowsOf(await (await open(repo())).render(request))
  assert.match(texts(rows).find((text) => text.startsWith("Branches")) ?? "", /Branches \(1\) main/)
})

test("angka nol tidak memakan ruang di judul Branches", async () => {
  const rows = rowsOf(await (await open(repo())).render(request))
  const branches = texts(rows).find((text) => text.startsWith("Branches")) ?? ""
  assert.ok(!branches.includes("↑0"), branches)
  assert.ok(!branches.includes("↓0"), branches)
})

test("tab berputar melewati kelima kolom lalu kembali ke Files", async () => {
  const panel = await open(repo())
  const opened = async () => {
    const rows = rowsOf(await panel.render(request))
    return rows.find((row) => row.color === "cyan")?.text.split(" ")[0]
  }
  assert.equal(await opened(), "Files")
  for (const expected of ["Worktrees", "Branches", "Commits", "Stash", "Files"]) {
    assert.equal(panel.onKey?.({ key: "tab" })?.refresh, true)
    assert.equal(await opened(), expected)
  }
})

test("panah menggerakkan kursor, dan kursor menandai tepat satu baris", async () => {
  const directory = repo()
  for (const name of ["b.txt", "c.txt", "d.txt"]) fs.writeFileSync(path.join(directory, name), "x\n")
  const panel = await open(directory)

  const cursor = async () => {
    const rows = rowsOf(await panel.render(request))
    const marked = rows.filter((row) => row.selected === true)
    assert.equal(marked.length, 1, `tepat satu kursor: ${JSON.stringify(texts(rows))}`)
    return marked[0]?.text ?? ""
  }

  const first = await cursor()
  assert.ok(first.startsWith("› "), first)
  assert.equal(panel.onKey?.({ key: "down" })?.refresh, true)
  assert.notEqual(await cursor(), first)
  assert.equal(panel.onKey?.({ key: "up" })?.refresh, true)
  assert.equal(await cursor(), first)
})

test("kursor DIJEPIT di kedua ujung, tidak berputar", async () => {
  const directory = repo()
  fs.writeFileSync(path.join(directory, "b.txt"), "b\n")
  const panel = await open(directory)
  await panel.render(request)

  const before = rowsOf(await panel.render(request)).find((row) => row.selected)?.text
  for (const key of ["up", "up", "down", "down"]) panel.onKey?.({ key })
  assert.equal(rowsOf(await panel.render(request)).find((row) => row.selected)?.text, before)
})

test("setiap kolom mengingat kursornya sendiri", async () => {
  /*
   * Kembali ke satu kolom sesudah menyusuri kolom lain harus mengembalikan
   * kursor ke baris yang sama. Satu kursor bersama membuat setiap perpindahan
   * kehilangan tempat — dan pada daftar yang di-window, memindahkan jendelanya.
   */
  const directory = repo()
  for (const name of ["b.txt", "c.txt", "d.txt"]) fs.writeFileSync(path.join(directory, name), "x\n")
  for (const branch of ["x", "y", "z"]) git(directory, "branch", branch)
  const panel = await open(directory)
  await panel.render(request)

  panel.onKey?.({ key: "down" })
  panel.onKey?.({ key: "down" })
  const filesCursor = rowsOf(await panel.render(request)).find((row) => row.selected)?.text

  panel.onKey?.({ key: "tab" })
  panel.onKey?.({ key: "tab" })
  await panel.render(request)
  panel.onKey?.({ key: "down" })
  await panel.render(request)
  for (let step = 0; step < 3; step++) panel.onKey?.({ key: "tab" })

  assert.equal(rowsOf(await panel.render(request)).find((row) => row.selected)?.text, filesCursor)
})

test("daftar yang lebih panjang dari panel di-window, dan kursor tetap terlihat", async () => {
  const directory = repo()
  for (let index = 0; index < 40; index++) {
    fs.writeFileSync(path.join(directory, `f${String(index).padStart(2, "0")}.txt`), "x\n")
  }
  const panel = await open(directory)
  const short = { ...request, rows: 12 } // budget = 12 - 5 - 1 = 6

  let rows = rowsOf(await panel.render(short))
  const entries = (list: ViewRow[]) =>
    list.filter((row) => row.text.startsWith("  ") || row.text.startsWith("› ")).length
  assert.equal(entries(rows), 6)

  for (let step = 0; step < 20; step++) panel.onKey?.({ key: "down" })
  rows = rowsOf(await panel.render(short))
  const marked = rows.filter((row) => row.selected === true)
  assert.equal(marked.length, 1, "kursor tetap terlihat sesudah menggulir")
  assert.match(marked[0]?.text ?? "", /f20\.txt/)
  assert.equal(entries(rows), 6, "jendela tidak melebar")
})

test("klik pada judul membuka kolomnya", async () => {
  const panel = await open(repo())
  const target = headerIndex(rowsOf(await panel.render(request)), "Commits")
  assert.ok(target > 0)
  assert.equal(panel.onClick?.({ row: target })?.refresh, true)
  assert.ok(
    rowsOf(await panel.render(request))
      .find((row) => row.color === "cyan")
      ?.text.startsWith("Commits"),
  )
})

test("klik pada judul yang SUDAH terbuka tidak meminta render ulang", async () => {
  // Render ulang tanpa perubahan adalah enam pemanggilan git yang dibayar untuk
  // hasil yang identik.
  const panel = await open(repo())
  const rows = rowsOf(await panel.render(request))
  assert.equal(panel.onClick?.({ row: headerIndex(rows, "Files") }), undefined)
})

test("klik pada entri memindahkan kursor ke baris itu", async () => {
  const directory = repo()
  for (const name of ["b.txt", "c.txt", "d.txt"]) fs.writeFileSync(path.join(directory, name), "x\n")
  const panel = await open(directory)
  await panel.render(request)

  // Judul Files di baris 0, entrinya di 1..3.
  assert.equal(panel.onClick?.({ row: 3 })?.refresh, true)
  const after = rowsOf(await panel.render(request))
  assert.equal(after[3]?.selected, true)
  assert.equal(after[1]?.selected, undefined)
})

test("klik pada baris petunjuk tidak melakukan apa pun", async () => {
  const panel = await open(repo())
  const rows = rowsOf(await panel.render(request))
  const hint = texts(rows).findIndex((text) => text.includes("tab section"))
  assert.ok(hint > 0)
  assert.equal(panel.onClick?.({ row: hint }), undefined)
})

test("klik di luar batas baris tidak melempar", async () => {
  const panel = await open(repo())
  await panel.render(request)
  assert.equal(panel.onClick?.({ row: 999 }), undefined)
  assert.equal(panel.onClick?.({ row: -1 }), undefined)
})

test("kolom yang kosong mengatakan keadaannya", async () => {
  const panel = await open(repo())
  assert.ok(texts(rowsOf(await panel.render(request))).includes("  clean"))

  for (let step = 0; step < 4; step++) panel.onKey?.({ key: "tab" })
  assert.ok(texts(rowsOf(await panel.render(request))).includes("  empty"))
})

test("worktree kedua muncul di kolomnya", async () => {
  const directory = repo()
  const extra = path.join(directory, "..", `wt-${path.basename(directory)}`)
  git(directory, "worktree", "add", "-q", "-b", "side", extra)
  try {
    const panel = await open(directory)
    await panel.render(request)
    panel.onKey?.({ key: "tab" })
    const rows = rowsOf(await panel.render(request))
    assert.match(texts(rows).find((text) => text.startsWith("Worktrees")) ?? "", /Worktrees \(2\)/)
  } finally {
    git(directory, "worktree", "remove", "--force", extra)
  }
})

test("commit terbaca sebagai hash pendek plus subjeknya", async () => {
  const directory = repo()
  fs.writeFileSync(path.join(directory, "b.txt"), "b\n")
  git(directory, "add", "b.txt")
  git(directory, "commit", "-q", "-m", "kedua")

  const panel = await open(directory)
  await panel.render(request)
  for (let step = 0; step < 3; step++) panel.onKey?.({ key: "tab" })
  const rows = rowsOf(await panel.render(request))
  assert.match(texts(rows).find((text) => text.startsWith("Commits")) ?? "", /Commits \(2\)/)
  assert.match(texts(rows)[headerIndex(rows, "Commits") + 1] ?? "", /^› [0-9a-f]{7,} kedua/)
})

test("stash muncul dengan penanda dan pesannya", async () => {
  const directory = repo()
  fs.writeFileSync(path.join(directory, "a.txt"), "berubah\n")
  git(directory, "stash", "push", "-q", "-m", "simpan-dulu")

  const panel = await open(directory)
  await panel.render(request)
  for (let step = 0; step < 4; step++) panel.onKey?.({ key: "tab" })
  const rows = rowsOf(await panel.render(request))
  assert.match(texts(rows).find((text) => text.startsWith("Stash")) ?? "", /Stash \(1\)/)
  assert.match(texts(rows)[headerIndex(rows, "Stash") + 1] ?? "", /stash@\{0\}/)
})

test("commitLimit membatasi yang ditampilkan", async () => {
  const directory = repo()
  for (let index = 0; index < 5; index++) {
    fs.writeFileSync(path.join(directory, `c${index}.txt`), "x\n")
    git(directory, "add", ".")
    git(directory, "commit", "-q", "-m", `c${index}`)
  }
  const panel = await open(directory, { commitLimit: 3 })
  await panel.render(request)
  for (let step = 0; step < 3; step++) panel.onKey?.({ key: "tab" })
  const rows = rowsOf(await panel.render(request))
  assert.match(texts(rows).find((text) => text.startsWith("Commits")) ?? "", /Commits \(3\)/)
})

test("start memilih kolom yang terbuka pertama", async () => {
  const rows = rowsOf(await (await open(repo(), { start: "commits" })).render(request))
  assert.ok(rows.find((row) => row.color === "cyan")?.text.startsWith("Commits"))
})

test("start yang tidak dikenal jatuh ke Files, bukan ke panel kosong", async () => {
  const rows = rowsOf(await (await open(repo(), { start: "tidak-ada" })).render(request))
  assert.ok(rows.find((row) => row.color === "cyan")?.text.startsWith("Files"))
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

test("tombol selain tab, panah, dan r tidak melakukan apa pun", async () => {
  /*
   * Panel ini HANYA memantau. Tidak ada tombol yang mengubah working tree, dan
   * itu bukan karena belum kesampaian: panel berjalan tanpa melewati dialog izin
   * Titah, jadi satu tekanan yang mengubah repo tidak akan pernah ditanyakan
   * kepada siapa pun.
   */
  const panel = await open(repo())
  await panel.render(request)
  for (const key of ["c", "s", "d", "x", "return", "delete", "a", "p"]) {
    assert.equal(panel.onKey?.({ key }), undefined, `tombol ${key} harus diam`)
  }
})

test("HEAD yang detached dikatakan apa adanya", async () => {
  const directory = repo()
  const sha = git(directory, "rev-parse", "HEAD").trim()
  git(directory, "checkout", "-q", sha)
  const rows = rowsOf(await (await open(directory)).render(request))
  assert.match(texts(rows).find((text) => text.startsWith("Branches")) ?? "", /detached/)
})

test("signal yang sudah dibatalkan tidak menggantung dan tidak melempar", async () => {
  const rows = rowsOf(await (await open(repo())).render({ ...request, signal: AbortSignal.abort() }))
  assert.deepEqual(rows, [{ text: "not a git repo", dim: true }])
})

// --- penguraian ------------------------------------------------------------

test("baris ## milik --branch tidak dihitung sebagai berkas", () => {
  // Menghitungnya membuat repo bersih selalu melaporkan satu perubahan — dan
  // tidak ada yang curiga pada angka satu.
  assert.deepEqual(parseStatus("## main...origin/main\n M src/a.ts\n"), [{ status: " M", path: "src/a.ts" }])
  assert.deepEqual(parseStatus("## main\n"), [])
})

test("rename menyimpan nama BARU, bukan yang lama", () => {
  // Itu berkas yang ada sekarang, dan itu yang dicari orang di daftar.
  assert.deepEqual(parseStatus("R  lama.ts -> baru.ts\n"), [{ status: "R ", path: "baru.ts" }])
})

test("berkas tak terlacak dan yang di-stage dibedakan status duanya", () => {
  assert.deepEqual(parseStatus("?? baru.ts\nA  ditambah.ts\nMM dua.ts\n"), [
    { status: "??", path: "baru.ts" },
    { status: "A ", path: "ditambah.ts" },
    { status: "MM", path: "dua.ts" },
  ])
})

test("snapshot menjalankan keenam perintahnya bersamaan, bukan berurutan", async () => {
  /*
   * Batas waktu Titah dua detik, dan sekarang ada ENAM perintah git. Berurutan,
   * panel pada repo besar menunggu jumlah keenamnya — jadi penungguan yang lolos
   * di repo kecil akan timeout di repo yang justru paling butuh panel ini.
   *
   * Diukur, bukan dibaca dari bentuk kode.
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

test("branch saat ini SELALU baris pertama, apa pun urutan committerdate", async () => {
  /*
   * Diukur pada repo demo, bukan diduga: `--sort=-committerdate` pada repo yang
   * branch-nya menunjuk commit yang sama menghasilkan urutan sembarang, dan
   * `main` mendarat di urutan keempat. Di accordion dengan tiga baris, itu
   * berarti branch yang sedang dipakai tergeser keluar layar — informasi yang
   * paling dibutuhkan justru yang paling mudah hilang.
   */
  const directory = repo()
  for (const branch of ["aaa", "bbb", "ccc", "zzz"]) git(directory, "branch", branch)

  const panel = await open(directory)
  await panel.render(request)
  panel.onKey?.({ key: "tab" })
  panel.onKey?.({ key: "tab" })
  const rows = rowsOf(await panel.render(request))
  const at = headerIndex(rows, "Branches")
  assert.match(texts(rows)[at + 1] ?? "", /main$/, JSON.stringify(texts(rows)))
})

test("currentFirst tidak menduplikasi dan tidak menyentuh sisanya", () => {
  assert.deepEqual(currentFirst(["a", "main", "b"], "main"), ["main", "a", "b"])
  assert.deepEqual(currentFirst(["a", "b"], "main"), ["a", "b"], "branch yang tidak ada dibiarkan")
  assert.deepEqual(currentFirst(["a", "b"], undefined), ["a", "b"], "detached HEAD")
  assert.deepEqual(currentFirst([], "main"), [])
})
