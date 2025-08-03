local settings = require("settings")
local colors = require("colors")

local zen_mode = {
	active = false,
	all_displays = "1,2,3",
	busy_displays = "1,3",
}
zen_mode["draw_displays"] = zen_mode.all_displays

local exec = function(displays)
	-- local f = io.open("/tmp/wierd.state", "w")
	-- f:write("zen-mode: " .. tostring(zen_mode.active))
	-- f:close()
	sbar.bar({
		topmost = "window",
		height = settings.bar.height,
		color = colors.bar.bg,
		padding_right = 2,
		padding_left = 2,
		display = displays,
	})

	--sbar.exec("sketchybar --trigger zen_displays DISPLAYS=" .. displays)
end

local events = sbar.add("item", "events", {
	width = 0,
	y_offset = -5,
	icon = {
		drawing = false,
	},
	label = {
		drawing = false,
	},
	position = "left",
})

events:subscribe({ "toggle_zen_mode" }, function(env)
	if zen_mode.active then
		zen_mode.active = false
		exec(zen_mode.all_displays)
	else
		zen_mode.active = true
		exec(zen_mode.busy_displays)
	end
end)

return {
	handler = function(item)
		item:subscribe({ "zen_displays" }, function(env)
			item:set({
				display = env.DISPLAYS,
			})
		end)
	end,
	zen_mode = zen_mode,
}
