import assert from "node:assert/strict"
import test from "node:test"
import { HINT, layout, moveCursor, nextSection, plan, SECTIONS, shortenPath } from "../src/sections.ts"
import type { SectionId } from "../src/sections.ts"

const counts = (over: Partial<Record<SectionId, number>> = {}): Record<SectionId, number> => ({
  files: 0,
  worktrees: 0,
  branches: 0,
  commits: 0,
  stash: 0,
  ...over,
})

test("kolom yang terbuka mendapat sisa baris sesudah judul dan petunjuk", () => {
  /*
   * Lima judul (satu per kolom) plus satu baris petunjuk. Meleset satu di sini
   * berarti baris terakhir daftar tidak pernah bisa dicapai kursor, atau panel
   * tumbuh melewati tinggi yang sudah direservasi Titah.
   */
  const result = layout({ rows: 20, counts: counts({ commits: 50 }), focused: "commits", cursor: 0 })
  assert.equal(result.budget, 20 - SECTIONS.length - 1)
  assert.equal(result.budget, 14)
  assert.equal(result.visible, 14)
  assert.equal(result.offset, 0)
})

test("panel yang lebih pendek dari judul-judulnya tidak menghasilkan budget negatif", () => {
  // Budget negatif diteruskan ke pemotongan daftar dan berubah jadi slice yang
  // membuang segalanya secara diam-diam.
  for (const rows of [0, 1, 5, 6]) {
    const result = layout({ rows, counts: counts({ files: 9 }), focused: "files", cursor: 0 })
    assert.ok(result.budget >= 0, `rows=${rows}`)
    assert.ok(result.visible >= 0, `rows=${rows}`)
  }
  assert.equal(layout({ rows: 6, counts: counts({ files: 9 }), focused: "files", cursor: 0 }).budget, 0)
})

test("jendela digeser SECUKUPNYA supaya kursor terlihat, bukan dipusatkan", () => {
  /*
   * Dipusatkan, daftar melompat setiap kali kursor bergerak satu baris — dan
   * mata kehilangan tempatnya justru saat sedang menyusuri daftar.
   */
  const input = { rows: 10, counts: counts({ commits: 20 }), focused: "commits" as SectionId }
  // budget = 10 - 5 - 1 = 4
  assert.equal(layout({ ...input, cursor: 0 }).offset, 0)
  assert.equal(layout({ ...input, cursor: 3 }).offset, 0, "masih di dalam jendela pertama")
  assert.equal(layout({ ...input, cursor: 4 }).offset, 1, "baru bergeser satu")
  assert.equal(layout({ ...input, cursor: 5 }).offset, 2)
})

test("jendela berhenti di ujung daftar, tidak menggulir ke ruang kosong", () => {
  const result = layout({ rows: 10, counts: counts({ commits: 6 }), focused: "commits", cursor: 5 })
  assert.equal(result.offset, 2, "6 entri, budget 4 → offset maksimum 2")
  assert.equal(result.visible, 4)
})

test("daftar yang lebih pendek dari budget tidak pernah digeser", () => {
  const result = layout({ rows: 20, counts: counts({ stash: 2 }), focused: "stash", cursor: 1 })
  assert.equal(result.offset, 0)
  assert.equal(result.visible, 2)
})

test("kolom kosong menghasilkan nol baris terlihat, bukan satu baris hantu", () => {
  const result = layout({ rows: 20, counts: counts(), focused: "files", cursor: 0 })
  assert.equal(result.visible, 0)
})

test("kursor DIJEPIT, tidak berputar", () => {
  /*
   * Di daftar yang di-window, berputar dari baris terakhir ke baris pertama
   * memindahkan seluruh jendela sekaligus — dan dari tempat user itu terlihat
   * seperti daftar yang tiba-tiba berganti isi.
   */
  assert.equal(moveCursor(0, -1, 5), 0)
  assert.equal(moveCursor(4, 1, 5), 4)
  assert.equal(moveCursor(2, 1, 5), 3)
  assert.equal(moveCursor(2, -1, 5), 1)
})

test("kursor pada daftar kosong tetap nol", () => {
  assert.equal(moveCursor(0, 1, 0), 0)
  assert.equal(moveCursor(7, -1, 0), 0)
})

test("kursor yang tertinggal di luar batas dijepit ke entri terakhir", () => {
  // Terjadi sungguhan: berkas di-commit di antara dua render, jadi daftar
  // menyusut sementara kursornya tidak.
  assert.equal(moveCursor(9, 0, 3), 2)
})

test("tab berputar maju melewati kelima kolom lalu kembali", () => {
  assert.deepEqual(
    SECTIONS.map((section) => section.id),
    ["files", "worktrees", "branches", "commits", "stash"],
  )
  assert.equal(nextSection("files"), "worktrees")
  assert.equal(nextSection("stash"), "files", "berputar dari yang terakhir")
})

test("plan menggambar lima judul, isi kolom fokus, lalu petunjuk", () => {
  const rows = plan({
    rows: 12,
    counts: counts({ files: 3, branches: 7 }),
    focused: "files",
    cursor: 1,
    entries: ["·M a.ts", "A  b.ts", "?? c.ts"],
    emptyLabel: "clean",
  })

  assert.deepEqual(
    rows.map((row) => (row.kind === "header" ? `H:${row.section}` : row.kind === "entry" ? `E:${row.text}` : row.kind)),
    ["H:files", "E:·M a.ts", "E:A  b.ts", "E:?? c.ts", "H:worktrees", "H:branches", "H:commits", "H:stash", "hint"],
  )
  assert.equal(rows.at(-1)?.kind, "hint")
  assert.equal(rows.at(-1)?.kind === "hint" ? rows.at(-1)?.text : "", HINT)
})

test("hanya SATU judul yang ditandai fokus", () => {
  const rows = plan({
    rows: 12,
    counts: counts({ branches: 2 }),
    focused: "branches",
    cursor: 0,
    entries: ["main", "wip"],
    emptyLabel: "none",
  })
  const focusedHeaders = rows.filter((row) => row.kind === "header" && row.focused)
  assert.equal(focusedHeaders.length, 1)
  assert.equal(focusedHeaders[0]?.kind === "header" ? focusedHeaders[0].section : "", "branches")
})

test("kursor menandai tepat satu entri, dan entri yang benar", () => {
  const rows = plan({
    rows: 12,
    counts: counts({ commits: 4 }),
    focused: "commits",
    cursor: 2,
    entries: ["a1 satu", "b2 dua", "c3 tiga", "d4 empat"],
    emptyLabel: "no commits",
  })
  const marked = rows.filter((row) => row.kind === "entry" && row.cursor)
  assert.equal(marked.length, 1)
  assert.equal(marked[0]?.kind === "entry" ? marked[0].text : "", "c3 tiga")
})

test("indeks entri adalah indeks di DAFTAR, bukan di layar", () => {
  /*
   * Ini yang dipakai klik untuk memindahkan kursor. Kalau ia indeks layar,
   * mengklik baris teratas dari jendela yang sudah tergulir akan melompat ke
   * awal daftar — dan itu terlihat seperti klik yang meleset jauh.
   */
  const rows = plan({
    rows: 10,
    counts: counts({ commits: 20 }),
    focused: "commits",
    cursor: 9,
    entries: Array.from({ length: 20 }, (_, index) => `c${index}`),
    emptyLabel: "no commits",
  })
  const entries = rows.filter((row) => row.kind === "entry")
  assert.equal(entries.length, 4, "budget 4")
  assert.deepEqual(
    entries.map((row) => (row.kind === "entry" ? row.index : -1)),
    [6, 7, 8, 9],
  )
})

test("kolom fokus yang kosong menampilkan kalimatnya, bukan kotak hampa", () => {
  const rows = plan({
    rows: 12,
    counts: counts(),
    focused: "stash",
    cursor: 0,
    entries: [],
    emptyLabel: "empty",
  })
  const empty = rows.filter((row) => row.kind === "empty")
  assert.equal(empty.length, 1)
  assert.equal(empty[0]?.kind === "empty" ? empty[0].text : "", "empty")
})

test("panel tanpa ruang isi tetap menggambar judul dan petunjuk", () => {
  // Judul adalah satu-satunya hal yang masih berguna di panel yang terlalu
  // pendek: jumlah per kolom tetap terbaca.
  const rows = plan({
    rows: 6,
    counts: counts({ files: 5 }),
    focused: "files",
    cursor: 0,
    entries: ["a", "b", "c", "d", "e"],
    emptyLabel: "clean",
  })
  assert.equal(rows.filter((row) => row.kind === "entry").length, 0)
  assert.equal(rows.filter((row) => row.kind === "header").length, SECTIONS.length)
  assert.equal(rows.at(-1)?.kind, "hint")
})

test("path dipendekkan dari DEPAN supaya nama berkasnya bertahan", () => {
  /*
   * `truncate` milik Titah memotong ekor, dan untuk path itu membuang
   * satu-satunya bagian yang membedakan: dua berkas berbeda di direktori yang
   * sama akan terlihat identik.
   */
  // Hasilnya PERSIS selebar yang diminta, elipsis termasuk hitungan.
  assert.equal(shortenPath("src/tui/panels.ts", 12), "…i/panels.ts")
  assert.equal(shortenPath("src/tui/panels.ts", 12).length, 12)
  assert.ok(shortenPath("src/tui/panels.ts", 12).endsWith("panels.ts"))
  assert.equal(shortenPath("short.ts", 12), "short.ts", "yang muat tidak disentuh")
})

test("pemendekan path pada lebar yang tidak masuk akal tidak melempar", () => {
  assert.equal(shortenPath("src/a.ts", 1), "s")
  assert.equal(shortenPath("src/a.ts", 0), "")
  assert.equal(shortenPath("src/a.ts", -3), "")
})
