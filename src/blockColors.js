// Rough top-down colors for the !mc map renderer. Not exhaustive — anything
// missing falls back to a dye-color guess or a stable hash color so unknown
// (mostly modded) blocks still render as *something* distinct rather than
// a flat gray blob.

const TABLE = {
  grass_block: [95, 159, 53], mycelium: [111, 96, 92], dirt: [134, 96, 67],
  coarse_dirt: [117, 85, 60], rooted_dirt: [136, 105, 74], podzol: [104, 82, 47],
  mud: [63, 61, 62], muddy_mangrove_roots: [84, 62, 51], farmland: [102, 76, 53],
  dirt_path: [151, 114, 74],
  sand: [219, 209, 160], red_sand: [190, 101, 34], sandstone: [219, 202, 152],
  gravel: [136, 126, 122], clay: [159, 164, 177],
  stone: [125, 125, 125], andesite: [136, 136, 136], diorite: [188, 188, 188],
  granite: [149, 108, 89], deepslate: [77, 77, 82], tuff: [108, 109, 102],
  calcite: [224, 224, 216], cobblestone: [124, 124, 124], mossy_cobblestone: [107, 124, 93],
  bedrock: [85, 85, 85], obsidian: [20, 18, 29], crying_obsidian: [32, 10, 48],
  netherrack: [110, 53, 51], soul_sand: [82, 64, 51], soul_soil: [75, 61, 48],
  basalt: [90, 88, 96], blackstone: [42, 36, 40], magma_block: [151, 76, 29],
  glowstone: [171, 131, 84], nether_gold_ore: [155, 97, 65], nether_quartz_ore: [154, 106, 104],
  end_stone: [219, 219, 165], end_stone_bricks: [209, 209, 166], purpur_block: [169, 125, 169],
  water: [63, 118, 228], lava: [217, 90, 20], ice: [138, 187, 252], packed_ice: [141, 180, 250],
  blue_ice: [116, 167, 253], snow: [248, 248, 248], snow_block: [248, 248, 248],
  powder_snow: [233, 241, 246],
  moss_block: [89, 121, 39], moss_carpet: [89, 121, 39], sculk: [21, 42, 50],
  sculk_catalyst: [43, 55, 56], sculk_vein: [43, 71, 75], amethyst_block: [133, 101, 189],
  budding_amethyst: [122, 89, 178], glass: [220, 235, 240],
  oak_log: [110, 89, 54], oak_leaves: [72, 114, 40], oak_planks: [162, 130, 78],
  spruce_log: [66, 48, 28], spruce_leaves: [61, 92, 60], spruce_planks: [114, 84, 48],
  birch_log: [216, 210, 196], birch_leaves: [96, 124, 62], birch_planks: [196, 178, 122],
  jungle_log: [86, 66, 35], jungle_leaves: [58, 111, 30], jungle_planks: [160, 116, 86],
  acacia_log: [104, 100, 90], acacia_leaves: [93, 124, 44], acacia_planks: [168, 90, 50],
  dark_oak_log: [60, 46, 27], dark_oak_leaves: [58, 82, 34], dark_oak_planks: [67, 43, 20],
  mangrove_log: [117, 54, 51], mangrove_leaves: [72, 114, 40], mangrove_planks: [117, 54, 51],
  cherry_log: [147, 88, 86], cherry_leaves: [237, 171, 209], cherry_planks: [222, 176, 170],
  azalea_leaves: [102, 128, 62], flowering_azalea_leaves: [102, 128, 62],
  grass: [95, 159, 53], tall_grass: [95, 159, 53], fern: [85, 141, 64],
  vine: [72, 114, 40], lily_pad: [55, 121, 40],
  coal_ore: [95, 95, 95], iron_ore: [175, 152, 133], copper_ore: [151, 141, 106],
  gold_ore: [197, 175, 90], redstone_ore: [140, 84, 78], lapis_ore: [82, 108, 157],
  diamond_ore: [120, 197, 199], emerald_ore: [86, 189, 121],
  deepslate_coal_ore: [70, 70, 74], deepslate_iron_ore: [131, 124, 118],
  deepslate_copper_ore: [113, 116, 100], deepslate_gold_ore: [148, 138, 91],
  deepslate_redstone_ore: [104, 82, 80], deepslate_lapis_ore: [79, 96, 116],
  deepslate_diamond_ore: [103, 152, 152], deepslate_emerald_ore: [83, 141, 105],
  copper_block: [180, 105, 76], oxidized_copper: [82, 162, 132], weathered_copper: [111, 156, 117],
  exposed_copper: [149, 130, 104], iron_block: [222, 222, 222], gold_block: [247, 223, 87],
  diamond_block: [123, 234, 218], emerald_block: [66, 209, 127], lapis_block: [43, 78, 154],
  netherite_block: [69, 63, 62], coal_block: [16, 16, 16], redstone_block: [172, 22, 10],
  quartz_block: [235, 229, 222], bricks: [151, 96, 78], mud_bricks: [136, 116, 91],
  hay_block: [196, 161, 26], honey_block: [244, 165, 34], honeycomb_block: [230, 130, 29],
  bone_block: [219, 213, 173], target: [216, 175, 158], scaffolding: [193, 152, 88],
  cactus: [69, 105, 34], melon: [111, 148, 35], pumpkin: [192, 108, 18],
  carved_pumpkin: [192, 108, 18], jack_o_lantern: [211, 137, 36],
  sponge: [196, 196, 77], wet_sponge: [174, 174, 68],
  prismarine: [99, 156, 150], prismarine_bricks: [99, 172, 158], dark_prismarine: [51, 92, 73],
  sea_lantern: [197, 219, 207], kelp: [63, 109, 46], seagrass: [45, 120, 60],
  chest: [141, 109, 62], crafting_table: [124, 83, 51], furnace: [111, 111, 111],
}

const DYE = {
  white: [233, 236, 236], orange: [240, 118, 19], magenta: [189, 68, 179],
  light_blue: [58, 175, 217], yellow: [248, 198, 39], lime: [112, 185, 25],
  pink: [237, 141, 172], gray: [62, 68, 71], light_gray: [142, 142, 134],
  cyan: [21, 137, 145], purple: [121, 42, 172], blue: [53, 57, 157],
  brown: [114, 71, 40], green: [84, 109, 27], red: [161, 39, 34], black: [20, 21, 25],
}

function hashColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return [100 + (h & 0x7f), 100 + ((h >> 7) & 0x7f), 100 + ((h >> 14) & 0x7f)]
}

export function blockColor(namespacedName) {
  const name = namespacedName.replace(/^minecraft:/, '')
  if (TABLE[name]) return TABLE[name]
  for (const dye of Object.keys(DYE)) {
    if (name.startsWith(dye + '_') || name.endsWith('_' + dye)) return DYE[dye]
  }
  if (/leaves$/.test(name)) return TABLE.oak_leaves
  if (/log$|wood$|stem$/.test(name)) return TABLE.oak_log
  if (/planks$/.test(name)) return TABLE.oak_planks
  if (/ore$/.test(name)) return [150, 150, 150]
  return hashColor(name)
}
