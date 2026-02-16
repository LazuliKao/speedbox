'use strict';
'require view';
'require uci';
'require fs';

return view.extend({
	load: function () {
		return uci.load('speedbox').then(function () {
			return uci.get('speedbox', 'main', 'port') || '8080';
		});
	},

	render: function (port) {
		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Speedbox — LAN Speed Test')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Embedded speed test frontend.  Backend runs on port %s.').format(port)),
			E('iframe', {
				'id': 'speedbox-frame',
				'src': '/speedbox/index.html',
				'style': 'width:100%;height:600px;border:none;border-radius:8px;background:#f5f5f5;',
				'allow': 'fullscreen',
			}),
		]);

		return container;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
