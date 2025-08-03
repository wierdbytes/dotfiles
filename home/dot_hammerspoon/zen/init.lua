local active = false

local on = function()
	active = true
end

local off = function()
	active = false
end

local toggle = function()
	active = not active
end

local is_active = function()
	return active
end

local function bar_offset()
	if zen.is_active() then
		return 0
	else
		return 24
	end
end

return {
	is_active = is_active,
	toggle = toggle,
	on = on,
	off = off,
	bar_offset = bar_offset,
}
