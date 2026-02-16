# SPDX-License-Identifier: MIT
#
# Speedbox – OpenWrt package Makefile (Rust backend)
#
# This Makefile follows the OpenWrt package feed conventions.
# It expects the OpenWrt SDK (with rust-package.mk) to be available at build time.
# On a host system without the SDK it can only be syntax-audited.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=speedbox
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk
# Rust cross-compilation support — provided by openwrt-rust overlay
include ../../feeds/packages/lang/rust/rust-package.mk

define Package/speedbox
  SECTION:=net
  CATEGORY:=Network
  TITLE:=LAN Speed Test Backend
  DEPENDS:=$(RUST_ARCH_DEPENDS)
  URL:=https://github.com/user/speedbox
endef

define Package/speedbox/description
  Lightweight LAN speed test server for OpenWrt.
  Streams random data to measure download/upload throughput.
endef

define Package/speedbox/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/bin/speedbox $(1)/usr/bin/speedbox

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/speedbox.init $(1)/etc/init.d/speedbox

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/speedbox.config $(1)/etc/config/speedbox
endef

$(eval $(call RustBinPackage,speedbox))
$(eval $(call BuildPackage,speedbox))
