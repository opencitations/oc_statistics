// Encoding for Google Maps API key
const p1 = 'QUl6YVN5RC05dFNy';
const p2 = 'a2U3MlBvdVE=';
const p3 = 'TW5NWC1hN2U=';
const p4 = 'WlNXMGprRk0=';
const p5 = 'QldZ';

google.charts.load('current', {
  'packages': ['geochart'],
  'mapsApiKey': atob(p1) + atob(p2) + atob(p3) + atob(p4) + atob(p5)
});

let myGeoChart = null;

$(window).load(function () {
  let last_date;
  let lastDate;
  const baseurl = window.location.origin;
  console.log("Base URL for API requests: " + baseurl);

  // Helper function to extract API and HTTP status code requests from Prometheus data
  function extractMetrics(prom_to_dict) {
    let api_req, status_200, status_301, status_404, status_503, status_others;
    
    if (prom_to_dict.opencitations_api_requests_total) {
      api_req = prom_to_dict.opencitations_api_requests_total;
    } 
    else if (prom_to_dict.opencitations_agg_counter_total && 
             prom_to_dict.opencitations_agg_counter_total.oc_api_requests) {
      api_req = prom_to_dict.opencitations_agg_counter_total.oc_api_requests;
    } else {
      api_req = 0;
    }

    // Extract HTTP status codes
    status_200 = 0;
    status_301 = 0;
    status_404 = 0;
    status_503 = 0;
    status_others = 0;

    if (prom_to_dict.opencitations_requests_by_status_total) {
      const statusCodes = prom_to_dict.opencitations_requests_by_status_total;
      
      // Main status codes
      status_200 = Number(statusCodes['200'] || 0);
      status_301 = Number(statusCodes['301'] || 0);
      status_404 = Number(statusCodes['404'] || 0);
      status_503 = Number(statusCodes['503'] || 0);
      
      // Calculate others (all codes except 200, 301, 404, 503)
      for (const [code, count] of Object.entries(statusCodes)) {
        if (code !== '200' && code !== '301' && code !== '404' && code !== '503') {
          status_others += Number(count);
        }
      }
    }

    return { api_req, status_200, status_301, status_404, status_503, status_others };
  }

  // Helper function to extract country data
  function extractCountryData(prom_to_dict) {
    if (prom_to_dict.opencitations_requests_by_country_total) {
      return prom_to_dict.opencitations_requests_by_country_total;
    }
    return {};
  }

  // Helper function to extract API breakdown data
  function extractAPIBreakdown(prom_to_dict) {
    let index_v1 = 0, index_v2 = 0, meta = 0;
    
    // New format
    if (prom_to_dict.opencitations_api_index_requests_by_version_total) {
      index_v1 = Number(prom_to_dict.opencitations_api_index_requests_by_version_total.v1 || 0);
      index_v2 = Number(prom_to_dict.opencitations_api_index_requests_by_version_total.v2 || 0);
    }
    
    if (prom_to_dict.opencitations_api_meta_requests_total) {
      meta = Number(prom_to_dict.opencitations_api_meta_requests_total);
    }
    
    return { index_v1, index_v2, meta };
  }

  // Helper function to parse country line and extract both name and ISO
  function parseCountryLine(line) {
    const nameMatch = line.match(/country="([^"]+)"/);
    const isoMatch = line.match(/country_iso="([^"]+)"/);
    
    return {
      name: nameMatch ? nameMatch[1] : null,
      iso: isoMatch ? isoMatch[1] : null
    };
  }

  function drawGeoMap(countryData) {
    let dataArray = [['Country', 'Requests', {type: 'string', role: 'tooltip'}]];
    
    for (const countryIso in countryData) {
      if (countryIso !== 'Unknown' && countryIso !== 'XX') {
        const name = countryData[countryIso].name || countryIso;
        const count = countryData[countryIso].count;
        
        let tooltip;
        if (countryIso === 'CN' && countryData[countryIso].details) {
          // Special case for China with Hong Kong details
          const details = countryData[countryIso].details;
          tooltip = `${name} (including Hong Kong)\n`;
          if (details.china > 0) {
            tooltip += `China: ${details.china.toLocaleString()}\n`;
          }
          if (details.hongkong > 0) {
            tooltip += `Hong Kong: ${details.hongkong.toLocaleString()}\n`;
          }
          tooltip += `Total: ${count.toLocaleString()}`;
        } else {
          tooltip = `${name} - ${countryIso}\nRequests: ${count.toLocaleString()}`;
        }
        
        dataArray.push([countryIso, count, tooltip]);
      }
    }

    var data = google.visualization.arrayToDataTable(dataArray);

    let allCounts = Object.values(countryData).map(c => c.count).filter(c => c > 0);
    let minValue = Math.min(...allCounts);
    let maxValue = Math.max(...allCounts);
    
    let logMin = Math.log10(minValue);
    let logMax = Math.log10(maxValue);
    
    let colorValues = [];
    for (let i = 0; i < 12; i++) {
      let logValue = logMin + (logMax - logMin) * i / 11;
      colorValues.push(Math.round(Math.pow(10, logValue)));
    }

    var options = {
      colorAxis: {
        values: colorValues,
        colors: [
          '#ffffff',
          '#e6f2ff',
          '#cce5ff',
          '#99ccff',
          '#66b3ff',
          '#3399ff',
          '#0080ff',
          '#0066cc',
          '#004d99',
          '#003366',
          '#001a33',
          '#000d1a'
        ]
      },
      backgroundColor: 'transparent',
      datalessRegionColor: '#f7f7f7',
      defaultColor: '#e0e0e0',
      legend: {
        numberFormat: 'short'
      },
      tooltip: {
        trigger: 'focus',
        isHtml: false
      },
      region: 'world',
      displayMode: 'regions',
      resolution: 'countries',
      keepAspectRatio: true,
      width: '100%',
      height: '100%'
    };

    var chart = new google.visualization.GeoChart(document.getElementById('regions_div'));
    chart.draw(data, options);
    
    setTimeout(function() {
      chart.draw(data, options);
    }, 100);
    
    if (!window.geoChartResizeListener) {
      window.geoChartResizeListener = true;
      window.addEventListener('resize', function() {
        if (window.myGeoChart && window.lastGeoData && window.lastGeoOptions) {
          window.myGeoChart.draw(window.lastGeoData, window.lastGeoOptions);
        }
      });
    }
    
    window.lastGeoData = data;
    window.lastGeoOptions = options;
    
    return chart;
}

  // Default data visualizations
  axios.get(baseurl+'/statistics/last-month')
    .then(function (response) {
      metricsStr = response.data;
      var array0 = metricsStr.split(/\r?\n/);
      var filtered0 = array0.filter(function (value, index, arr) {
        return (!value.startsWith("#")) && (value.includes("opencitations_date_info"));
      });
      last_m_y = filtered0[0];

      function extractAllText(last_m_y) {
        const re = /"(.*?)"/g;
        const result = [];
        let current;
        while (current = re.exec(last_m_y)) {
          result.push(current.pop());
        }
        return (result.length > 0 ? result : [last_m_y]);
      };

      let date_list = extractAllText(last_m_y)
      let end_year = date_list[1]
      let end_month = date_list[0]
      last_date = String(end_year + "-" + end_month)
      $("#End_1").val(end_month + "/" + end_year)
      $("#End").val(end_month + "/" + end_year)
      $("#End_2").val(end_month + "/" + end_year)
      $("#End_3").val(end_month + "/" + end_year)
      lastDate = new Date(last_date)
    })
    .catch(function (error) {
      console.log(error);
    })
    .then(function () {
      function subtractMonths(numOfMonths, date) {
        ybf_date = new Date(date)
        ybf_date.setMonth(ybf_date.getMonth() - numOfMonths);
        return ybf_date;
      };

      let yearbeforeDate = subtractMonths(6, lastDate);

      function get_YYYY_MM_date(date_format) {
        let month = String(date_format.getUTCMonth() + 1);
        if (month.length < 2) {
          month = "0" + month;
        }
        let year = String(date_format.getUTCFullYear());
        return year + "-" + month
      };

      let yearbefore_date = get_YYYY_MM_date(yearbeforeDate)

      get_start_input_date_array = yearbefore_date.split("-");
      st_year = get_start_input_date_array[0];
      st_month = get_start_input_date_array[1];
      $("#Start_1").val(st_month + "/" + st_year);
      $("#Start").val(st_month + "/" + st_year);
      $("#Start_2").val(st_month + "/" + st_year);
      $("#Start_3").val(st_month + "/" + st_year);

      function get_default_query_array(st_mon, end_mon) {
        let dateStart = moment(st_mon);
        let dateEnd = moment(end_mon);
        let timeValues = [];

        while (dateEnd > dateStart || dateStart.format('M') === dateEnd.format('M')) {
          timeValues.push(baseurl+"/statistics/" + dateStart.format('YYYY-MM'));
          dateStart.add(1, 'month');
        }
        return timeValues;
      };

      let default_query_array = get_default_query_array(yearbefore_date, last_date);

      months = { "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun", "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };

      // Bar chart initialization
      requests_list = []
      for (i = 0; i < default_query_array.length; i++) {
        let ax_req_serv = axios.get(default_query_array[i])
        requests_list.push(ax_req_serv)
      }

      let dict_name = {};
      axios.all(requests_list).then(axios.spread((...responses) => {
        for (i = 0; i < responses.length; i++) {
          element = default_query_array[i];
          const datePattern = /(\d{4})\-(\d{1,2})/;
          const date = datePattern.exec(element);
          metricsStr = (responses[i]).data;

          var array1 = metricsStr.split(/\r?\n/);
          var filtered = array1.filter(function (value, index, arr) {
            return !value.startsWith("#");
          });

          prom_to_dict = {}

          const pattern = /{/;
          function extractQuotedText(str) {
            const matches = str.match(/"(.*?)"/);
            return (matches ? matches[1] : str);
          };

          for (let i = 0; i < filtered.length; i++) {
            if (pattern.test(filtered[i]) == true) {
              let pos_open_par = filtered[i].indexOf('{')
              let pos_close_par = filtered[i].indexOf('}')

              let dict_key = filtered[i].substr(0, pos_open_par);
              if (!(dict_key in prom_to_dict)) {
                prom_to_dict[dict_key] = {}
              };

              let nest_dict_key = extractQuotedText(filtered[i]);
              let nest_dict_val = filtered[i].substr(pos_close_par + 2);

              prom_to_dict[dict_key][nest_dict_key] = nest_dict_val

            } else {
              let pos_space = filtered[i].indexOf(' ');
              let dict_key = filtered[i].substr(0, pos_space);
              let dict_val = filtered[i].substr(pos_space + 1);
              prom_to_dict[dict_key] = dict_val
            };
          }

          const { api_req, status_200, status_301, status_404, status_503, status_others } = extractMetrics(prom_to_dict);

          let result = {};
          result["api_requests"] = Number(api_req);
          result["status_200"] = Number(status_200);
          result["status_301"] = Number(status_301);
          result["status_404"] = Number(status_404);
          result["status_503"] = Number(status_503);
          result["status_others"] = Number(status_others);

          key_name = months[date[2]] + " " + date[1];
          dict_name[key_name] = result;
        }

        api_req_list = [];
        status_200_list = [];
        status_301_list = [];
        status_404_list = [];
        status_503_list = [];
        status_others_list = [];
        labels_list = [];

        for (const key in dict_name) {
          labels_list.push(key);
          api_req_list.push(dict_name[key].api_requests);
          status_200_list.push(dict_name[key].status_200);
          status_301_list.push(dict_name[key].status_301);
          status_404_list.push(dict_name[key].status_404);
          status_503_list.push(dict_name[key].status_503);
          status_others_list.push(dict_name[key].status_others);
        }

        var barChartData = {
          labels: labels_list,
          datasets: [
            {
              label: "API",
              backgroundColor: "#3C41E5",
              borderColor: "#3C41E5",
              borderWidth: 1,
              data: api_req_list,
              stack: 'stack0'
            },
            {
              label: "200 OK",
              backgroundColor: "#28a745",
              borderColor: "#28a745",
              borderWidth: 1,
              data: status_200_list,
              stack: 'stack1'
            },
            {
              label: "301 Redirect",
              backgroundColor: "#17a2b8",
              borderColor: "#17a2b8",
              borderWidth: 1,
              data: status_301_list,
              stack: 'stack1'
            },
            {
              label: "404 Not Found",
              backgroundColor: "#ffc107",
              borderColor: "#ffc107",
              borderWidth: 1,
              data: status_404_list,
              stack: 'stack1'
            },
            {
              label: "503 Service Unavailable",
              backgroundColor: "#dc3545",
              borderColor: "#dc3545",
              borderWidth: 1,
              data: status_503_list,
              stack: 'stack1'
            },
            {
              label: "Other HTTP Codes",
              backgroundColor: "#6c757d",
              borderColor: "#6c757d",
              borderWidth: 1,
              data: status_others_list,
              stack: 'stack1'
            }
          ]
        };

        var chartOptions = {
          responsive: true,
          legend: {
            position: "top"
          },
          title: {
            display: true,
            text: "Services Usage Bar Chart"
          },
          scales: {
            y: {
              display: true,
              type: 'logarithmic',
            }
          }
        }

        var ctx = document.getElementById("myChart2").getContext("2d");

        myBar = new Chart(ctx, {
          type: "bar",
          data: barChartData,
          options: chartOptions
        });

      })).catch(errors => {
        console.error("Error loading bar chart data:", errors);
      });

      // LineChart for Indexed Records
      let default_query_array_bimestr = [];
      for (const [index, element] of default_query_array.entries()) {
        if (index % 2 == 0) {
          default_query_array_bimestr.push(element);
        }
      }

      requests_list_1 = []

      for (i = 0; i < default_query_array_bimestr.length; i++) {
        let ax_req = axios.get(default_query_array_bimestr[i])
        requests_list_1.push(ax_req)
      }

      let dict_name_1 = {};
      axios.all(requests_list_1).then(axios.spread((...responses) => {
        for (i = 0; i < responses.length; i++) {
          element = default_query_array_bimestr[i];
          const datePattern = /(\d{4})\-(\d{1,2})/;
          const date = datePattern.exec(element);
          metricsStr = (responses[i]).data;

          var array1 = metricsStr.split(/\r?\n/);
          var filtered = array1.filter(function (value, index, arr) {
            return !value.startsWith("#");
          });
          prom_to_dict = {}
          const pattern = /{/;
          function extractQuotedText(str) {
            const matches = str.match(/"(.*?)"/);
            return (matches ? matches[1] : str);
          };

          for (let i = 0; i < filtered.length; i++) {
            if (pattern.test(filtered[i]) == true) {
              let pos_open_par = filtered[i].indexOf('{')
              let pos_close_par = filtered[i].indexOf('}')

              let dict_key = filtered[i].substr(0, pos_open_par);
              if (!(dict_key in prom_to_dict)) {
                prom_to_dict[dict_key] = {}
              };

              let nest_dict_key = extractQuotedText(filtered[i]);
              let nest_dict_val = filtered[i].substr(pos_close_par + 2);

              prom_to_dict[dict_key][nest_dict_key] = nest_dict_val

            } else {
              let pos_space = filtered[i].indexOf(' ');
              let dict_key = filtered[i].substr(0, pos_space);
              let dict_val = filtered[i].substr(pos_space + 1);
              prom_to_dict[dict_key] = dict_val
            };
          }

          ind_rec = prom_to_dict.opencitations_indexed_records
          let result = {};
          result["indexed_records"] = Number(ind_rec);
          key_name = months[date[2]] + " " + date[1];
          dict_name_1[key_name] = result;
        }

        ind_rec_list = [];
        labels_list = [];

        for (const key in dict_name_1) {
          labels_list.push(key);
          ind_rec_list.push(dict_name_1[key].indexed_records);
        }

        var lineChartData = {
          labels: labels_list,
          datasets: [
            {
              label: "OC Indexed Records",
              backgroundColor: "#AB54FD",
              borderColor: "purple",
              borderWidth: 1,
              data: ind_rec_list
            },
          ]
        }

        var lineChartOptions = {
          responsive: true,
          legend: {
            position: "top"
          },
          title: {
            display: true,
            text: "Indexed records Line Chart"
          },
          scales: {
            y: {
              display: true,
              type: 'linear',
            }
          }
        }

        var ctx2 = document.getElementById("myChart").getContext("2d");
        myLine = new Chart(ctx2, {
          type: "line",
          data: lineChartData,
          options: lineChartOptions
        });

      })).catch(errors => {
        console.error("Error loading line chart data:", errors);
      })

      // API Breakdown Chart initialization
      requests_list_3 = []
      for (i = 0; i < default_query_array.length; i++) {
        let ax_req_api = axios.get(default_query_array[i])
        requests_list_3.push(ax_req_api)
      }

      let dict_name_3 = {};
      axios.all(requests_list_3).then(axios.spread((...responses) => {
        for (i = 0; i < responses.length; i++) {
          element = default_query_array[i];
          const datePattern = /(\d{4})\-(\d{1,2})/;
          const date = datePattern.exec(element);
          metricsStr = (responses[i]).data;

          var array1 = metricsStr.split(/\r?\n/);
          var filtered = array1.filter(function (value, index, arr) {
            return !value.startsWith("#");
          });

          prom_to_dict = {}
          const pattern = /{/;
          function extractQuotedText(str) {
            const matches = str.match(/"(.*?)"/);
            return (matches ? matches[1] : str);
          };

          for (let i = 0; i < filtered.length; i++) {
            if (pattern.test(filtered[i]) == true) {
              let pos_open_par = filtered[i].indexOf('{')
              let pos_close_par = filtered[i].indexOf('}')

              let dict_key = filtered[i].substr(0, pos_open_par);
              if (!(dict_key in prom_to_dict)) {
                prom_to_dict[dict_key] = {}
              };

              let nest_dict_key = extractQuotedText(filtered[i]);
              let nest_dict_val = filtered[i].substr(pos_close_par + 2);

              prom_to_dict[dict_key][nest_dict_key] = nest_dict_val

            } else {
              let pos_space = filtered[i].indexOf(' ');
              let dict_key = filtered[i].substr(0, pos_space);
              let dict_val = filtered[i].substr(pos_space + 1);
              prom_to_dict[dict_key] = dict_val
            };
          }

          const { index_v1, index_v2, meta } = extractAPIBreakdown(prom_to_dict);
          let result = {};
          result["index_v1"] = index_v1;
          result["index_v2"] = index_v2;
          result["meta"] = meta;
          
          key_name = months[date[2]] + " " + date[1];
          dict_name_3[key_name] = result;
        }

        index_v1_list = [];
        index_v2_list = [];
        meta_list = [];
        labels_list_3 = [];

        for (const key in dict_name_3) {
          labels_list_3.push(key);
          index_v1_list.push(dict_name_3[key].index_v1);
          index_v2_list.push(dict_name_3[key].index_v2);
          meta_list.push(dict_name_3[key].meta);
        }

        var apiBreakdownData = {
          labels: labels_list_3,
          datasets: [
            {
              label: "INDEX v1",
              backgroundColor: "#FF6384",
              borderColor: "#FF6384",
              borderWidth: 1,
              data: index_v1_list
            },
            {
              label: "INDEX v2",
              backgroundColor: "#36A2EB",
              borderColor: "#36A2EB",
              borderWidth: 1,
              data: index_v2_list
            },
            {
              label: "META",
              backgroundColor: "#FFCE56",
              borderColor: "#FFCE56",
              borderWidth: 1,
              data: meta_list
            }
          ]
        };

        var apiBreakdownOptions = {
          responsive: true,
          legend: {
            position: "top"
          },
          title: {
            display: true,
            text: "API Requests Breakdown"
          },
          scales: {
            x: {
              stacked: true
            },
            y: {
              stacked: true,
              display: true
            }
          }
        }

        var ctx4 = document.getElementById("myChart4").getContext("2d");
        myAPIBreakdown = new Chart(ctx4, {
          type: "bar",
          data: apiBreakdownData,
          options: apiBreakdownOptions
        });

      })).catch(errors => {
        console.error("Error loading API breakdown chart data:", errors);
      })

      // Geographic Map (Google GeoChart)
      google.charts.setOnLoadCallback(function() {
        requests_list_2 = []
        for (i = 0; i < default_query_array.length; i++) {
          let ax_req_country = axios.get(default_query_array[i])
          requests_list_2.push(ax_req_country)
        }

        let country_aggregated = {};
        axios.all(requests_list_2).then(axios.spread((...responses) => {
          for (i = 0; i < responses.length; i++) {
            metricsStr = (responses[i]).data;

            var array1 = metricsStr.split(/\r?\n/);
            var filtered = array1.filter(function (value, index, arr) {
              return !value.startsWith("#");
            });

            // Process country lines separately
            for (let j = 0; j < filtered.length; j++) {
              const line = filtered[j];
              if (line.includes('opencitations_requests_by_country_total{')) {
                const countryInfo = parseCountryLine(line);
                if (countryInfo.iso && countryInfo.name) {
                  // Extract the count value
                  const valuePart = line.split('} ')[1];
                  const count = Number(valuePart);
                  
                  // Aggregate Hong Kong (HK) into China (CN)
                  if (countryInfo.iso === 'HK') {
                    if (!country_aggregated['CN']) {
                      country_aggregated['CN'] = { 
                        name: 'China', 
                        count: 0,
                        details: { china: 0, hongkong: 0 }
                      };
                    }
                    country_aggregated['CN'].count += count;
                    country_aggregated['CN'].details.hongkong += count;
                  } else if (countryInfo.iso === 'CN') {
                    if (!country_aggregated['CN']) {
                      country_aggregated['CN'] = { 
                        name: 'China', 
                        count: 0,
                        details: { china: 0, hongkong: 0 }
                      };
                    }
                    country_aggregated['CN'].count += count;
                    country_aggregated['CN'].details.china += count;
                  } else {
                    // Other countries
                    if (!country_aggregated[countryInfo.iso]) {
                      country_aggregated[countryInfo.iso] = { 
                        name: countryInfo.name, 
                        count: 0 
                      };
                    }
                    country_aggregated[countryInfo.iso].count += count;
                  }
                }
              }
            }
          }

          myGeoChart = drawGeoMap(country_aggregated);
          window.myGeoChart = myGeoChart;
          done();

        })).catch(errors => {
          console.error("Error loading geographic map data:", errors);
          done();
        })
      });
    })
    .then(function () {
      function elapsedMonths(d1, d2) {
        var months;
        months = (d2.getFullYear() - d1.getFullYear()) * 12;
        months -= d1.getMonth();
        months += d2.getMonth();
        return months <= 0 ? 0 : months;
      }

      let init_data_month = new Date('2021-01-01')
      let cur_data_month = new Date();
      let ultima_data_array = $("#End").val().split("/")
      let ultima_data = ultima_data_array[0] + "/01/" + ultima_data_array[1]
      let latest_data_month = new Date(ultima_data);

      let elapsed_record_months = elapsedMonths(init_data_month, cur_data_month);
      let latest_cur_elapsed_record_months = elapsedMonths(latest_data_month, cur_data_month);

      let split_array_start = $("#Start").val().split("/")
      let split_array_end = $("#End").val().split("/")

      let start = split_array_start[1] + "-" + split_array_start[0];
      let end = split_array_end[1] + "-" + split_array_end[0];
      let StartDate = new Date(split_array_start[0] + "/01/" + split_array_start[1]);
      let EndDate = new Date(split_array_end[0] + "/01/" + split_array_end[1]);
      let Interval = 1;

      let start_1 = split_array_start[1] + "-" + split_array_start[0];
      let end_1 = split_array_end[1] + "-" + split_array_end[0];
      let StartDate_1 = new Date(split_array_start[0] + "/01/" + split_array_start[1]);
      let EndDate_1 = new Date(split_array_end[0] + "/01/" + split_array_end[1]);
      let Interval_1 = 2;

      let start_2 = split_array_start[1] + "-" + split_array_start[0];
      let end_2 = split_array_end[1] + "-" + split_array_end[0];
      let StartDate_2 = new Date(split_array_start[0] + "/01/" + split_array_start[1]);
      let EndDate_2 = new Date(split_array_end[0] + "/01/" + split_array_end[1]);

      let start_3 = split_array_start[1] + "-" + split_array_start[0];
      let end_3 = split_array_end[1] + "-" + split_array_end[0];
      let StartDate_3 = new Date(split_array_start[0] + "/01/" + split_array_start[1]);
      let EndDate_3 = new Date(split_array_end[0] + "/01/" + split_array_end[1]);
      let Interval_3 = 1;

      // Month pickers configuration
      $('#Start').MonthPicker({
        MaxMonth: - latest_cur_elapsed_record_months,
        MinMonth: - elapsed_record_months,
        OnAfterChooseMonth: function (selectedDate) {
          StartDate = selectedDate;
          year = selectedDate.getFullYear();
          month = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
          let date_for_query = year + "-" + month;
          start = date_for_query;
          $('#Invio').click();
        }
      });

      $('#Start_1').MonthPicker({
        MaxMonth: - latest_cur_elapsed_record_months,
        MinMonth: - elapsed_record_months,
        OnAfterChooseMonth: function (selectedDate) {
          StartDate_1 = selectedDate;
          year_1 = selectedDate.getFullYear();
          month_1 = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
          let date_for_query_1 = year_1 + "-" + month_1;
          start_1 = date_for_query_1;
          $('#Invio_1').click();
        }
      });

      $('#Start_2').MonthPicker({
        MaxMonth: - latest_cur_elapsed_record_months,
        MinMonth: - elapsed_record_months,
        OnAfterChooseMonth: function (selectedDate) {
          StartDate_2 = selectedDate;
          year_2 = selectedDate.getFullYear();
          month_2 = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
          let date_for_query_2 = year_2 + "-" + month_2;
          start_2 = date_for_query_2;
          $('#Invio_2').click();
        }
      });

      $('#Start_3').MonthPicker({
        MaxMonth: - latest_cur_elapsed_record_months,
        MinMonth: - elapsed_record_months,
        OnAfterChooseMonth: function (selectedDate) {
          StartDate_3 = selectedDate;
          year_3 = selectedDate.getFullYear();
          month_3 = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
          let date_for_query_3 = year_3 + "-" + month_3;
          start_3 = date_for_query_3;
          $('#Invio_3').click();
        }
      });

      $('#End').MonthPicker({
        MaxMonth: - latest_cur_elapsed_record_months,
        MinMonth: - elapsed_record_months,
        OnAfterChooseMonth: function (selectedDate) {
          EndDate = selectedDate;
          year = selectedDate.getFullYear();
          month = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
          let date_for_query = year + "-" + month;
          end = date_for_query;
          $('#Invio').click();
        }
      });

      $('#End_1').MonthPicker({
        MaxMonth: - latest_cur_elapsed_record_months,
        MinMonth: - elapsed_record_months,
        OnAfterChooseMonth: function (selectedDate) {
          EndDate_1 = selectedDate;
          year_1 = selectedDate.getFullYear();
          month_1 = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
          let date_for_query_1 = year_1 + "-" + month_1;
          end_1 = date_for_query_1;
          $('#Invio_1').click();
        }
      });

      $('#End_2').MonthPicker({
        MaxMonth: - latest_cur_elapsed_record_months,
        MinMonth: - elapsed_record_months,
        OnAfterChooseMonth: function (selectedDate) {
          EndDate_2 = selectedDate;
          year_2 = selectedDate.getFullYear();
          month_2 = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
          let date_for_query_2 = year_2 + "-" + month_2;
          end_2 = date_for_query_2;
          $('#Invio_2').click();
        }
      });

      $('#End_3').MonthPicker({
        MaxMonth: - latest_cur_elapsed_record_months,
        MinMonth: - elapsed_record_months,
        OnAfterChooseMonth: function (selectedDate) {
          EndDate_3 = selectedDate;
          year_3 = selectedDate.getFullYear();
          month_3 = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
          let date_for_query_3 = year_3 + "-" + month_3;
          end_3 = date_for_query_3;
          $('#Invio_3').click();
        }
      });

      $('#Intervallo').on('change', function () {
        Interval = ($(this).val());
        $('#Invio').click();
      });

      $('#Intervallo_1').on('change', function () {
        Interval_1 = ($(this).val());
        $('#Invio_1').click();
      });

      $('#Intervallo_3').on('change', function () {
        Interval_3 = ($(this).val());
        $('#Invio_3').click();
      });

      // Bar Chart Update Handler
      $('#Invio').click(function () {
        if (StartDate == "" && EndDate == "") {
          window.alert("Select a Start Date and an End Date (Bar Chart)")
        } else if (StartDate == "") {
          window.alert("Select a Start Date (Bar Chart)")
        } else if (EndDate == "") {
          window.alert("Select an End Date (Bar Chart)")
        } else {
          if (StartDate >= EndDate) {
            StartDate = ""
            EndDate = ""
            $('#Start').val("")
            $('#End').val("")
            window.alert("Start Date must precede End Date (Bar Chart)")
            throw "Start Date must precede End Date (Bar Chart)"
          } else {
            var start_Date = moment(start);
            var end_Date = moment(end);
            var result = [];
            while (start_Date.isBefore(end_Date)) {
              result.push(baseurl+"/statistics/" + start_Date.format("YYYY-MM"));
              start_Date.add(1, 'month');
            }
            result.push(baseurl+"/statistics/" + end_Date.format("YYYY-MM"))
          }

          let result_w_interval = [];
          if (Interval == 1) {
            result_w_interval = result;
          } else {
            for (const [index, element] of result.entries()) {
              if (index % Interval == 0) {
                result_w_interval.push(element);
              }
            }
          }

          requests_list = []
          for (i = 0; i < result_w_interval.length; i++) {
            let ax_req_serv = axios.get(result_w_interval[i])
            requests_list.push(ax_req_serv)
          }

          let dict_name = {};
          months = { "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun", "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };

          axios.all(requests_list).then(axios.spread((...responses) => {
            for (i = 0; i < responses.length; i++) {
              element = result_w_interval[i];
              const datePattern = /(\d{4})\-(\d{1,2})/;
              const date = datePattern.exec(element);
              metricsStr = (responses[i]).data;

              var array1 = metricsStr.split(/\r?\n/);
              var filtered = array1.filter(function (value, index, arr) {
                return !value.startsWith("#");
              });

              prom_to_dict = {}
              const pattern = /{/;
              function extractQuotedText(str) {
                const matches = str.match(/"(.*?)"/);
                return (matches ? matches[1] : str);
              };

              for (let i = 0; i < filtered.length; i++) {
                if (pattern.test(filtered[i]) == true) {
                  let pos_open_par = filtered[i].indexOf('{')
                  let pos_close_par = filtered[i].indexOf('}')
                  let dict_key = filtered[i].substr(0, pos_open_par);
                  if (!(dict_key in prom_to_dict)) {
                    prom_to_dict[dict_key] = {}
                  };
                  let nest_dict_key = extractQuotedText(filtered[i]);
                  let nest_dict_val = filtered[i].substr(pos_close_par + 2);
                  prom_to_dict[dict_key][nest_dict_key] = nest_dict_val
                } else {
                  let pos_space = filtered[i].indexOf(' ');
                  let dict_key = filtered[i].substr(0, pos_space);
                  let dict_val = filtered[i].substr(pos_space + 1);
                  prom_to_dict[dict_key] = dict_val
                };
              }

              const { api_req, status_200, status_301, status_404, status_503, status_others } = extractMetrics(prom_to_dict);
              let result = {};
              result["api_requests"] = Number(api_req);
              result["status_200"] = Number(status_200);
              result["status_301"] = Number(status_301);
              result["status_404"] = Number(status_404);
              result["status_503"] = Number(status_503);
              result["status_others"] = Number(status_others);
              key_name = months[date[2]] + " " + date[1];
              dict_name[key_name] = result;
            }

            api_req_list = [];
            status_200_list = [];
            status_301_list = [];
            status_404_list = [];
            status_503_list = [];
            status_others_list = [];
            labels_list = [];

            for (const key in dict_name) {
              labels_list.push(key);
              api_req_list.push(dict_name[key].api_requests);
              status_200_list.push(dict_name[key].status_200);
              status_301_list.push(dict_name[key].status_301);
              status_404_list.push(dict_name[key].status_404);
              status_503_list.push(dict_name[key].status_503);
              status_others_list.push(dict_name[key].status_others);
            }

            myBar.destroy()

            var barChartData = {
              labels: labels_list,
              datasets: [
                {
                  label: "API",
                  backgroundColor: "#3C41E5",
                  borderColor: "#3C41E5",
                  borderWidth: 1,
                  data: api_req_list,
                  stack: 'stack0'
                },
                {
                  label: "200 OK",
                  backgroundColor: "#28a745",
                  borderColor: "#28a745",
                  borderWidth: 1,
                  data: status_200_list,
                  stack: 'stack1'
                },
                {
                  label: "301 Redirect",
                  backgroundColor: "#17a2b8",
                  borderColor: "#17a2b8",
                  borderWidth: 1,
                  data: status_301_list,
                  stack: 'stack1'
                },
                {
                  label: "404 Not Found",
                  backgroundColor: "#ffc107",
                  borderColor: "#ffc107",
                  borderWidth: 1,
                  data: status_404_list,
                  stack: 'stack1'
                },
                {
                  label: "503 Service Unavailable",
                  backgroundColor: "#dc3545",
                  borderColor: "#dc3545",
                  borderWidth: 1,
                  data: status_503_list,
                  stack: 'stack1'
                },
                {
                  label: "Other HTTP Codes",
                  backgroundColor: "#6c757d",
                  borderColor: "#6c757d",
                  borderWidth: 1,
                  data: status_others_list,
                  stack: 'stack1'
                }
              ]
            };

            var chartOptions = {
              responsive: true,
              legend: {
                position: "top"
              },
              title: {
                display: true,
                text: "Services Usage Bar Chart"
              },
              scales: {
                y: {
                  display: true,
                  type: 'logarithmic',
                }
              }
            }

            var ctx = document.getElementById("myChart2").getContext("2d");
            myBar = new Chart(ctx, {
              type: "bar",
              data: barChartData,
              options: chartOptions
            });

          })).catch(errors => {
            console.error("Error updating bar chart:", errors);
          })
        }
      });

      // Line Chart Update Handler
      $('#Invio_1').click(function () {
        if (StartDate_1 == "" && EndDate_1 == "") {
          window.alert("Select a Start Date and an End Date (Line Chart)")
        } else if (StartDate_1 == "") {
          window.alert("Select a Start Date (Line Chart)")
        } else if (EndDate_1 == "") {
          window.alert("Select an End Date (Line Chart)")
        } else {
          if (StartDate_1 >= EndDate_1) {
            StartDate_1 = ""
            EndDate_1 = ""
            $('#Start_1').val("")
            $('#End_1').val("")
            window.alert("Start Date must precede End Date (Line Chart)")
            throw "Start Date must precede End Date (Line Chart)"
          } else {
            var start_Date_1 = moment(start_1);
            var end_Date_1 = moment(end_1);
            var result_1 = [];
            while (start_Date_1.isBefore(end_Date_1)) {
              result_1.push(baseurl+"/statistics/" + start_Date_1.format("YYYY-MM"));
              start_Date_1.add(1, 'month');
            }
            result_1.push(baseurl+"/statistics/" + end_Date_1.format("YYYY-MM"))
          }

          let result_w_interval_1 = [];
          if (Interval_1 == 1) {
            result_w_interval_1 = result_1;
          } else {
            for (const [index, element] of result_1.entries()) {
              if (index % Interval_1 == 0) {
                result_w_interval_1.push(element);
              }
            }
          }

          requests_list_1 = []
          for (i = 0; i < result_w_interval_1.length; i++) {
            let ax_req = axios.get(result_w_interval_1[i])
            requests_list_1.push(ax_req)
          }

          let dict_name_1 = {};
          months = { "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun", "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };

          axios.all(requests_list_1).then(axios.spread((...responses) => {
            for (i = 0; i < responses.length; i++) {
              element = result_w_interval_1[i];
              const datePattern = /(\d{4})\-(\d{1,2})/;
              const date = datePattern.exec(element);
              metricsStr = (responses[i]).data;

              var array1 = metricsStr.split(/\r?\n/);
              var filtered = array1.filter(function (value, index, arr) {
                return !value.startsWith("#");
              });

              prom_to_dict = {}
              const pattern = /{/;
              function extractQuotedText(str) {
                const matches = str.match(/"(.*?)"/);
                return (matches ? matches[1] : str);
              };

              for (let i = 0; i < filtered.length; i++) {
                if (pattern.test(filtered[i]) == true) {
                  let pos_open_par = filtered[i].indexOf('{')
                  let pos_close_par = filtered[i].indexOf('}')
                  let dict_key = filtered[i].substr(0, pos_open_par);
                  if (!(dict_key in prom_to_dict)) {
                    prom_to_dict[dict_key] = {}
                  };
                  let nest_dict_key = extractQuotedText(filtered[i]);
                  let nest_dict_val = filtered[i].substr(pos_close_par + 2);
                  prom_to_dict[dict_key][nest_dict_key] = nest_dict_val
                } else {
                  let pos_space = filtered[i].indexOf(' ');
                  let dict_key = filtered[i].substr(0, pos_space);
                  let dict_val = filtered[i].substr(pos_space + 1);
                  prom_to_dict[dict_key] = dict_val
                };
              }

              ind_rec = prom_to_dict.opencitations_indexed_records
              let result = {};
              result["indexed_records"] = Number(ind_rec);
              key_name = months[date[2]] + " " + date[1];
              dict_name_1[key_name] = result;
            }

            ind_rec_list = [];
            labels_list = [];

            for (const key in dict_name_1) {
              labels_list.push(key);
              ind_rec_list.push(dict_name_1[key].indexed_records);
            }

            myLine.destroy()

            var lineChartData = {
              labels: labels_list,
              datasets: [
                {
                  label: "OC Indexed Records",
                  backgroundColor: "#AB54FD",
                  borderColor: "purple",
                  borderWidth: 1,
                  data: ind_rec_list
                },
              ]
            }

            var lineChartOptions = {
              responsive: true,
              legend: {
                position: "top"
              },
              title: {
                display: true,
                text: "Indexed records Line Chart"
              },
              scales: {
                y: {
                  display: true,
                  type: 'linear',
                }
              }
            }

            var ctx2 = document.getElementById("myChart").getContext("2d");
            myLine = new Chart(ctx2, {
              type: "line",
              data: lineChartData,
              options: lineChartOptions
            });

          })).catch(errors => {
            console.error("Error updating line chart:", errors);
          })
        }
      });

      // Geo Map Update Handler
      $('#Invio_2').click(function () {
        if (StartDate_2 == "" && EndDate_2 == "") {
          window.alert("Select a Start Date and an End Date")
        } else if (StartDate_2 == "") {
          window.alert("Select a Start Date")
        } else if (EndDate_2 == "") {
          window.alert("Select an End Date")
        } else {
          if (StartDate_2 >= EndDate_2) {
            StartDate_2 = ""
            EndDate_2 = ""
            $('#Start_2').val("")
            $('#End_2').val("")
            window.alert("Start Date must precede End Date")
            throw "Start Date must precede End Date"
          } else {
            var start_Date_2 = moment(start_2);
            var end_Date_2 = moment(end_2);
            var result_2 = [];
            while (start_Date_2.isBefore(end_Date_2)) {
              result_2.push(baseurl + "/statistics/" + start_Date_2.format("YYYY-MM"));
              start_Date_2.add(1, 'month');
            }
            result_2.push(baseurl + "/statistics/" + end_Date_2.format("YYYY-MM"))
          }

          requests_list_2 = []
          for (i = 0; i < result_2.length; i++) {
            let ax_req_country = axios.get(result_2[i])
            requests_list_2.push(ax_req_country)
          }

          let country_aggregated = {};

          axios.all(requests_list_2).then(axios.spread((...responses) => {
            for (i = 0; i < responses.length; i++) {
              metricsStr = (responses[i]).data;

              var array1 = metricsStr.split(/\r?\n/);
              var filtered = array1.filter(function (value, index, arr) {
                return !value.startsWith("#");
              });

              // Process country lines separately
              for (let j = 0; j < filtered.length; j++) {
                const line = filtered[j];
                if (line.includes('opencitations_requests_by_country_total{')) {
                  const countryInfo = parseCountryLine(line);
                  if (countryInfo.iso && countryInfo.name) {
                    const valuePart = line.split('} ')[1];
                    const count = Number(valuePart);
                    
                    // Aggregate Hong Kong (HK) into China (CN)
                    if (countryInfo.iso === 'HK') {
                      if (!country_aggregated['CN']) {
                        country_aggregated['CN'] = { 
                          name: 'China', 
                          count: 0,
                          details: { china: 0, hongkong: 0 }
                        };
                      }
                      country_aggregated['CN'].count += count;
                      country_aggregated['CN'].details.hongkong += count;
                    } else if (countryInfo.iso === 'CN') {
                      if (!country_aggregated['CN']) {
                        country_aggregated['CN'] = { 
                          name: 'China', 
                          count: 0,
                          details: { china: 0, hongkong: 0 }
                        };
                      }
                      country_aggregated['CN'].count += count;
                      country_aggregated['CN'].details.china += count;
                    } else {
                      // Other countries
                      if (!country_aggregated[countryInfo.iso]) {
                        country_aggregated[countryInfo.iso] = { 
                          name: countryInfo.name, 
                          count: 0 
                        };
                      }
                      country_aggregated[countryInfo.iso].count += count;
                    }
                  }
                }
              }
            }

            myGeoChart = drawGeoMap(country_aggregated);
            window.myGeoChart = myGeoChart;

          })).catch(errors => {
            console.error("Error updating geographic map:", errors);
          })
        }
      });

      // API Breakdown Chart Update Handler
      $('#Invio_3').click(function () {
        if (StartDate_3 == "" && EndDate_3 == "") {
          window.alert("Select a Start Date and an End Date (API Breakdown)")
        } else if (StartDate_3 == "") {
          window.alert("Select a Start Date (API Breakdown)")
        } else if (EndDate_3 == "") {
          window.alert("Select an End Date (API Breakdown)")
        } else {
          if (StartDate_3 >= EndDate_3) {
            StartDate_3 = ""
            EndDate_3 = ""
            $('#Start_3').val("")
            $('#End_3').val("")
            window.alert("Start Date must precede End Date (API Breakdown)")
            throw "Start Date must precede End Date (API Breakdown)"
          } else {
            var start_Date_3 = moment(start_3);
            var end_Date_3 = moment(end_3);
            var result_3 = [];
            while (start_Date_3.isBefore(end_Date_3)) {
              result_3.push(baseurl+"/statistics/" + start_Date_3.format("YYYY-MM"));
              start_Date_3.add(1, 'month');
            }
            result_3.push(baseurl+"/statistics/" + end_Date_3.format("YYYY-MM"))
          }

          let result_w_interval_3 = [];
          if (Interval_3 == 1) {
            result_w_interval_3 = result_3;
          } else {
            for (const [index, element] of result_3.entries()) {
              if (index % Interval_3 == 0) {
                result_w_interval_3.push(element);
              }
            }
          }

          requests_list_3 = []
          for (i = 0; i < result_w_interval_3.length; i++) {
            let ax_req_api = axios.get(result_w_interval_3[i])
            requests_list_3.push(ax_req_api)
          }

          let dict_name_3 = {};
          months = { "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun", "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };

          axios.all(requests_list_3).then(axios.spread((...responses) => {
            for (i = 0; i < responses.length; i++) {
              element = result_w_interval_3[i];
              const datePattern = /(\d{4})\-(\d{1,2})/;
              const date = datePattern.exec(element);
              metricsStr = (responses[i]).data;

              var array1 = metricsStr.split(/\r?\n/);
              var filtered = array1.filter(function (value, index, arr) {
                return !value.startsWith("#");
              });

              prom_to_dict = {}
              const pattern = /{/;
              function extractQuotedText(str) {
                const matches = str.match(/"(.*?)"/);
                return (matches ? matches[1] : str);
              };

              for (let i = 0; i < filtered.length; i++) {
                if (pattern.test(filtered[i]) == true) {
                  let pos_open_par = filtered[i].indexOf('{')
                  let pos_close_par = filtered[i].indexOf('}')
                  let dict_key = filtered[i].substr(0, pos_open_par);
                  if (!(dict_key in prom_to_dict)) {
                    prom_to_dict[dict_key] = {}
                  };
                  let nest_dict_key = extractQuotedText(filtered[i]);
                  let nest_dict_val = filtered[i].substr(pos_close_par + 2);
                  prom_to_dict[dict_key][nest_dict_key] = nest_dict_val
                } else {
                  let pos_space = filtered[i].indexOf(' ');
                  let dict_key = filtered[i].substr(0, pos_space);
                  let dict_val = filtered[i].substr(pos_space + 1);
                  prom_to_dict[dict_key] = dict_val
                };
              }

              const { index_v1, index_v2, meta } = extractAPIBreakdown(prom_to_dict);
              let result = {};
              result["index_v1"] = index_v1;
              result["index_v2"] = index_v2;
              result["meta"] = meta;
              
              key_name = months[date[2]] + " " + date[1];
              dict_name_3[key_name] = result;
            }

            index_v1_list = [];
            index_v2_list = [];
            meta_list = [];
            labels_list_3 = [];

            for (const key in dict_name_3) {
              labels_list_3.push(key);
              index_v1_list.push(dict_name_3[key].index_v1);
              index_v2_list.push(dict_name_3[key].index_v2);
              meta_list.push(dict_name_3[key].meta);
            }

            myAPIBreakdown.destroy()

            var apiBreakdownData = {
              labels: labels_list_3,
              datasets: [
                {
                  label: "INDEX v1",
                  backgroundColor: "#FF6384",
                  borderColor: "#FF6384",
                  borderWidth: 1,
                  data: index_v1_list
                },
                {
                  label: "INDEX v2",
                  backgroundColor: "#36A2EB",
                  borderColor: "#36A2EB",
                  borderWidth: 1,
                  data: index_v2_list
                },
                {
                  label: "META",
                  backgroundColor: "#FFCE56",
                  borderColor: "#FFCE56",
                  borderWidth: 1,
                  data: meta_list
                }
              ]
            };

            var apiBreakdownOptions = {
              responsive: true,
              legend: {
                position: "top"
              },
              title: {
                display: true,
                text: "API Requests Breakdown"
              },
              scales: {
                x: {
                  stacked: true
                },
                y: {
                  stacked: true,
                  display: true
                }
              }
            }

            var ctx4 = document.getElementById("myChart4").getContext("2d");
            myAPIBreakdown = new Chart(ctx4, {
              type: "bar",
              data: apiBreakdownData,
              options: apiBreakdownOptions
            });

          })).catch(errors => {
            console.error("Error updating API breakdown chart:", errors);
          })
        }
      });

    });

});

function done() {
    document.getElementById("loading").style = "display: none;";
    document.getElementById("page_cont").style = "display: visible;";
    document.getElementsByTagName("footer")[0].style = "display: visible;"
    
    // Force redraw of the Google GeoChart after the container is visible
    if (window.myGeoChart && window.lastGeoData && window.lastGeoOptions) {
        setTimeout(function() {
            window.myGeoChart.draw(window.lastGeoData, window.lastGeoOptions);
        }, 200);
    }
}