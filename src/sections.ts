/**
 * Susunan accordion dan aritmetika kursornya, dipisah dari git dan dari render.
 *
 * Semua yang bisa meleset satu baris ada di sini: berapa baris yang tersisa untuk
 * kolom yang terbuka, jendela mana yang terlihat saat kursor turun melewati
 * bawah, dan baris layar keberapa yang berarti apa saat diklik. Ketiganya adalah
 * hitungan, dan hitungan yang tersebar di dalam komponen render adalah hitungan
 * yang tidak pernah diuji.
 */

export type SectionId = "files" | "worktrees" | "branches" | "commits" | "stash"

/**
 * Urutannya disengaja dan mengikuti lazygit: yang paling sering dilihat di atas.
 *
 * Files lebih dulu karena itu yang berubah setiap kali agent menyunting sesuatu.
 * Stash terakhir karena ia paling jarang, dan di accordion posisi terakhir adalah
 * yang paling murah untuk dilewati.
 */
export const SECTIONS: { id: SectionId; title: string }[] = [
  { id: "files", title: "Files" },
  { id: "worktrees", title: "Worktrees" },
  { id: "branches", title: "Branches" },
  { id: "commits", title: "Commits" },
  { id: "stash", title: "Stash" },
]

/** Satu baris petunjuk di dasar panel. */
export const HINT = "tab section · ↑↓ move"

export interface LayoutInput {
  /** Baris isi yang diberikan Titah, sudah bersih dari bingkai dan judul. */
  rows: number
  /** Panjang daftar per kolom. */
  counts: Record<SectionId, number>
  focused: SectionId
  /** Posisi kursor di kolom yang fokus. */
  cursor: number
}

export interface Layout {
  /** Baris yang tersedia untuk isi kolom yang terbuka. Bisa nol. */
  budget: number
  /** Indeks pertama yang terlihat di kolom yang terbuka. */
  offset: number
  /** Berapa entri yang benar-benar digambar. */
  visible: number
}

/**
 * Berapa ruang yang didapat kolom yang terbuka, dan jendela mana yang terlihat.
 *
 * Empat kolom yang tertutup memakan satu baris masing-masing, kolom yang terbuka
 * memakan satu baris judul, dan petunjuk memakan satu — jadi yang tersisa untuk
 * isi adalah `rows - jumlahKolom - 1`. Menghitungnya di tempat lain berarti
 * jendela gulir dan gambar bisa tidak sepakat, dan gejalanya baris terakhir yang
 * tidak pernah bisa dicapai kursor.
 */
export function layout(input: LayoutInput): Layout {
  const budget = Math.max(0, input.rows - SECTIONS.length - 1)
  const total = input.counts[input.focused]
  if (budget === 0 || total === 0) return { budget, offset: 0, visible: 0 }

  const cursor = clamp(input.cursor, 0, total - 1)
  /*
   * Jendela digeser hanya SECUKUPNYA supaya kursor terlihat, bukan dipusatkan.
   *
   * Dipusatkan, daftar melompat setiap kali kursor bergerak satu baris — dan
   * mata kehilangan tempatnya justru saat sedang menyusuri daftar. Digeser
   * secukupnya, daftar diam sampai kursor benar-benar menyentuh tepinya.
   */
  const offset = Math.max(0, Math.min(cursor - budget + 1, total - budget))
  return { budget, offset: Math.max(0, offset), visible: Math.min(budget, total - Math.max(0, offset)) }
}

/** Kolom berikutnya dalam putaran. Tab hanya maju — lihat catatan di README. */
export function nextSection(current: SectionId): SectionId {
  const index = SECTIONS.findIndex((section) => section.id === current)
  return SECTIONS[(index + 1) % SECTIONS.length]?.id ?? "files"
}

/**
 * Kursor sesudah satu tekanan panah.
 *
 * DIJEPIT, tidak berputar. Di daftar yang di-window, berputar dari baris
 * terakhir ke baris pertama memindahkan seluruh jendela sekaligus — dan dari
 * tempat user itu terlihat seperti daftar yang tiba-tiba berganti isi, bukan
 * seperti kursor yang kembali ke atas.
 */
export function moveCursor(cursor: number, delta: number, total: number): number {
  if (total === 0) return 0
  return clamp(cursor + delta, 0, total - 1)
}

export type Row =
  | { kind: "header"; section: SectionId; focused: boolean; title: string; count: number }
  | { kind: "entry"; section: SectionId; index: number; text: string; cursor: boolean }
  | { kind: "empty"; section: SectionId; text: string }
  | { kind: "hint"; text: string }

export interface PlanInput extends LayoutInput {
  /** Isi kolom yang terbuka, sudah jadi teks. */
  entries: string[]
  /** Kalimat untuk kolom yang terbuka tapi kosong, mis. "clean". */
  emptyLabel: string
}

/**
 * Daftar baris yang akan digambar, dalam urutan layar.
 *
 * Dikembalikan sebagai baris BERTIPE, bukan string, supaya satu peta yang sama
 * dipakai render DAN penanganan klik. Dua peta untuk satu susunan adalah cara
 * klik mengenai baris tetangga — dan itu bug yang terlihat seperti "kliknya
 * kurang akurat" alih-alih seperti hitungan yang salah.
 */
export function plan(input: PlanInput): Row[] {
  const { budget, offset, visible } = layout(input)
  const cursor = clamp(input.cursor, 0, Math.max(0, input.counts[input.focused] - 1))
  const rows: Row[] = []

  for (const section of SECTIONS) {
    const focused = section.id === input.focused
    rows.push({
      kind: "header",
      section: section.id,
      focused,
      title: section.title,
      count: input.counts[section.id],
    })
    if (!focused) continue

    if (input.counts[section.id] === 0) {
      // Kolom kosong mengatakan keadaannya. Kotak hampa di bawah judul yang
      // sedang fokus terlihat seperti pengambilan data yang gagal.
      if (budget > 0) rows.push({ kind: "empty", section: section.id, text: input.emptyLabel })
      continue
    }
    for (let index = 0; index < visible; index++) {
      const at = offset + index
      rows.push({
        kind: "entry",
        section: section.id,
        index: at,
        text: input.entries[at] ?? "",
        cursor: at === cursor,
      })
    }
  }

  rows.push({ kind: "hint", text: HINT })
  return rows
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high))
}

/**
 * Memendekkan path dari DEPAN, menyisakan ujungnya.
 *
 * `truncate` milik Titah memotong ekor, dan untuk path itu justru membuang
 * satu-satunya bagian yang membedakan: `src/tui/pane…` dan `src/tui/pane…`
 * bisa dua berkas berbeda. Nama berkasnya yang harus bertahan.
 */
export function shortenPath(value: string, width: number): string {
  if (width <= 1) return value.slice(0, Math.max(0, width))
  if (value.length <= width) return value
  return `…${value.slice(value.length - width + 1)}`
}
