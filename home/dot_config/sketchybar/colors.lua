return {
  black = 0xff181926,
  white = 0xffcad3f5,
  red = 0xffed8796,
  green = 0xffa6da95,
  blue = 0xff8aadf4,
  yellow = 0xffeed49f,
  orange = 0xfff5a97f,
  magenta = 0xfff5bde6,
  grey = 0xff6e738d,
  transparent = 0x00000000,

  accent = 0xbbc6a0f6,

  bar = {
    bg = 0xff181926,
    border = 0xff6e738d,
  },
  popup = {
    bg = 0xc02c2e34,
    border = 0xff6e738d
  },

  bg1 = 0xff24273a,

  bg2 = 0xff24273a,

  bg3 = 0x0f363944,

  with_alpha = function(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
  end,
}
