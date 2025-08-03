hs.ipc.cliInstall("/opt/homebrew")

-- stackline = require("stackline")
-- stackline:init()
-- stackline.config:toggle("appearance.showIcons")

-- Switch alacritty (from https://gist.github.com/truebit/31396bb2f48c75285d724c9e9e037bcd)
local spaces = require("hs.spaces") -- https://github.com/asmagill/hs._asm.spaces

local APP_NAME = "Ghostty"
local BUNDLE_ID = "com.mitchellh.ghostty"

FocusWatcher = hs.application.watcher.new(function(appName, eventType, appObject)
	if eventType == hs.application.watcher.deactivated and appName == APP_NAME then
		--print("appName= " .. appName .. ", eventType= " .. eventType)
		appObject:hide()
	end
end)
--FocusWatcher:start()
local displayplacer_string =
	'/opt/homebrew/bin/displayplacer "id:37D8832A-2D66-02CA-B9F7-8F30A301B230 res:1440x900 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0" "id:17566138-FA72-9A50-0857-D6964E3302DB res:2560x1440 hz:60 color_depth:8 enabled:true scaling:off origin:(1440,-120) degree:0" "id:CCA8DAF4-3F65-3C57-C90B-A2661D91F570 res:1600x1200 hz:60 color_depth:4 enabled:true scaling:on origin:(1920,1320) degree:0"'
hs.execute(displayplacer_string)

zen = require("zen")

hs.hotkey.bind({ "cmd", "alt", "ctrl", "shift" }, "T", function()
	function moveWindow(termemu, space, mainScreen)
		-- move to main space
		local win = nil
		while win == nil do
			win = termemu:mainWindow()
		end
		if win:isFullScreen() then
			hs.eventtap.keyStroke("cmd", "return", 0, termemu)
		end
		winFrame = win:frame()
		scrFrame = mainScreen:fullFrame()
		-- winFrame.w = scrFrame.w - 68
		-- winFrame.h = scrFrame.h - 120
		winFrame.h = 1320
		-- winFrame.y = scrFrame.y + 60
		winFrame.y = scrFrame.y + zen:bar_offset()
		-- winFrame.x = scrFrame.x + 34
		winFrame.w = scrFrame.w
		-- winFrame.h = scrFrame.h
		-- winFrame.y = scrFrame.y
		winFrame.x = scrFrame.x
		win:setFrame(winFrame, 0)
		spaces.moveWindowToSpace(win, space)
		if win:isFullScreen() then
			hs.eventtap.keyStroke("cmd", "return", 0, termemu)
		end
		win:focus()
	end

	local terminal = hs.application.get(BUNDLE_ID)
	if terminal ~= nil and terminal:isFrontmost() then
		terminal:hide()
	else
		local space = spaces.activeSpaceOnScreen()
		local mainScreen = hs.screen.mainScreen()
		if terminal == nil and hs.application.launchOrFocusByBundleID(BUNDLE_ID) then
			local appWatcher = nil
			appWatcher = hs.application.watcher.new(function(name, event, app)
				if event == hs.application.watcher.launched and app:bundleID() == BUNDLE_ID then
					app:hide()
					moveWindow(app, space, mainScreen)
					appWatcher:stop()
				end
			end)
			appWatcher:start()
		end
		if terminal ~= nil then
			moveWindow(terminal, space, mainScreen)
		end
	end
end)

function move_window(monitor, x, y, width, height)
	--print("monitor: ", monitor, "x: ", x, "y: ", y, "width: ", width, "height: ", height)
	local win = hs.window.focusedWindow()
	local scr = hs.screen(monitor)
	local space = spaces.activeSpaceOnScreen(scr)
	local winFrame = win:frame()
	local scrFrame = scr:fullFrame()

	local bar_offset = zen:bar_offset()

	local percent_x = scrFrame.w / 100 * x
	local percent_y = (scrFrame.h + bar_offset) / 100 * y
	local percent_w = scrFrame.w * (width / 100) - percent_x
	local percent_h = (scrFrame.h + bar_offset) * (height / 100)
	winFrame.x = percent_x + scrFrame.x
	winFrame.y = percent_y + scrFrame.y + bar_offset
	winFrame.h = percent_h
	winFrame.w = percent_w
	win:moveToScreen(scr, true, false, 0)
	win:setFrame(winFrame, 0)
end
