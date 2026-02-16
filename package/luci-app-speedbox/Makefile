# SPDX-License-Identifier: MIT
#
# luci-app-speedbox – LuCI frontend package for Speedbox
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Speedbox Speed Test
LUCI_DESCRIPTION:=Web UI for the Speedbox LAN speed test tool
LUCI_DEPENDS:=+speedbox +luci-base
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-speedbox
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

# LuCI uses a standard include for JS-only apps
include ../../luci.mk

# Community packages should use this dependency block
$(eval $(call BuildPackage,luci-app-speedbox))
